/**
 * Server-sent-event wrapper for a long agent run.
 *
 * Measured pricing runs take three to five minutes, which rules out a blocking
 * request: the user needs to see that something is happening, and a silent
 * multi-minute POST is indistinguishable from a hang.
 *
 * Two properties matter here:
 *
 *   1. The agent's work is NOT tied to the client connection. If the browser
 *      tab closes mid-run, `work()` keeps going and still writes its result to
 *      the database — the user reloads and finds the finished listing rather
 *      than having burned three minutes of research for nothing.
 *   2. A heartbeat comment goes out every 20s so intermediaries that reap idle
 *      connections don't kill a run that is legitimately just thinking.
 */
export function agentStream<T>(
	work: (
		progress: (note: string) => void,
		/** Emit a custom SSE event mid-run (e.g. an intermediate stage result).
		 *  A no-op once the client has disconnected — the run continues either way. */
		emitEvent: (event: string, data: unknown) => void
	) => Promise<T>
): Response {
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			let open = true;

			const emit = (event: string, data: unknown) => {
				if (!open) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					open = false; // client hung up; the run below continues regardless
				}
			};

			const heartbeat = setInterval(() => {
				if (!open) return;
				try {
					controller.enqueue(encoder.encode(': keepalive\n\n'));
				} catch {
					open = false;
				}
			}, 20_000);

			try {
				emit('progress', { note: 'starting' });
				const result = await work(
					(note) => emit('progress', { note }),
					(event, data) => emit(event, data)
				);
				emit('done', result);
			} catch (err) {
				emit('failed', { message: err instanceof Error ? err.message : 'the agent failed' });
			} finally {
				clearInterval(heartbeat);
				if (open) {
					try {
						controller.close();
					} catch {
						// already closed
					}
				}
			}
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			// Tell any reverse proxy not to buffer — buffering defeats the whole point.
			'x-accel-buffering': 'no'
		}
	});
}
