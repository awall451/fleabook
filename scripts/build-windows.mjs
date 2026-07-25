#!/usr/bin/env node
// Package Fleabook as a self-contained Windows folder.
//
// Runs on Linux (or Windows) and produces `dist-windows/Fleabook/`, plus a zip
// of it. Nothing here touches the Docker build — the Linux deployment path is
// `docker compose up -d --build` and is unaffected by anything in this file.
//
// What ends up in the package:
//
//   Fleabook.exe      the Go launcher (windows/launcher)
//   node/node.exe     a pinned Node runtime, so nothing has to be pre-installed
//   build/            adapter-node output from `npm run build`
//   node_modules/     production dependencies, resolved for win32-x64
//   package.json      needed at the root for "type": "module", same as the image
//
// Usage:
//   node scripts/build-windows.mjs            full build
//   node scripts/build-windows.mjs --no-zip   skip the archive step

import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist-windows');
const app = path.join(dist, 'Fleabook');
const cache = path.join(root, '.cache');

// Pinned to the runtime doing the build. The database layer uses the built-in
// node:sqlite module, which is only stable on recent Node — the same constraint
// that pins the Docker image to node:26-slim.
const NODE_VERSION = process.versions.node;
const NODE_MAJOR = Number(NODE_VERSION.split('.')[0]);
const NODE_DIR = `node-v${NODE_VERSION}-win-x64`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIR}.zip`;

const skipZip = process.argv.includes('--no-zip');

function log(step) {
	console.log(`\n▶ ${step}`);
}

function run(cmd, args, opts = {}) {
	execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
}

async function exists(p) {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

async function main() {
	if (NODE_MAJOR < 26) {
		throw new Error(
			`This build runs on Node ${NODE_VERSION}, and the packaged runtime is pinned to match it. ` +
				`node:sqlite needs Node 26 or newer — upgrade before packaging.`
		);
	}

	log('Cleaning');
	await rm(dist, { recursive: true, force: true });
	await mkdir(app, { recursive: true });
	await mkdir(cache, { recursive: true });

	log('Building the app');
	run('npm', ['run', 'build']);

	log(`Fetching the Node ${NODE_VERSION} Windows runtime`);
	const nodeZip = path.join(cache, `${NODE_DIR}.zip`);
	if (await exists(nodeZip)) {
		console.log('  (already downloaded)');
	} else {
		const res = await fetch(NODE_URL);
		if (!res.ok) throw new Error(`${NODE_URL} returned ${res.status}`);
		await pipeline(Readable.fromWeb(res.body), createWriteStream(nodeZip));
	}

	// -j flattens, so node.exe lands directly in node/ rather than under the
	// versioned directory the archive uses.
	await mkdir(path.join(app, 'node'), { recursive: true });
	run('unzip', ['-o', '-j', nodeZip, `${NODE_DIR}/node.exe`, '-d', path.join(app, 'node')]);

	log('Installing production dependencies for win32-x64');
	// --os/--cpu make npm resolve optionalDependencies for Windows rather than
	// the build host, which is what pulls @img/sharp-win32-x64 and
	// @anthropic-ai/claude-agent-sdk-win32-x64 instead of their linux builds.
	//
	// --ignore-scripts because install scripts would run as Linux here. None of
	// the production dependencies need one: sharp and the agent SDK both ship
	// prebuilt binaries as optional dependencies, not as postinstall steps. If a
	// dependency with a real install script is ever added, this needs revisiting.
	await cp(path.join(root, 'package.json'), path.join(app, 'package.json'));
	await cp(path.join(root, 'package-lock.json'), path.join(app, 'package-lock.json'));
	run('npm', [
		'ci',
		'--omit=dev',
		'--os=win32',
		'--cpu=x64',
		'--ignore-scripts',
		'--prefix',
		app
	]);

	log('Compiling the launcher');
	run(
		'go',
		['build', '-trimpath', '-ldflags', '-s -w', '-o', path.join(app, 'Fleabook.exe'), '.'],
		{
			cwd: path.join(root, 'windows', 'launcher'),
			env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' }
		}
	);

	log('Assembling');
	await cp(path.join(root, 'build'), path.join(app, 'build'), { recursive: true });
	await writeFile(path.join(app, 'README.txt'), readmeText(), 'utf8');
	// package-lock.json is only needed for the install above.
	await rm(path.join(app, 'package-lock.json'), { force: true });

	if (!skipZip) {
		log('Zipping');
		run('zip', ['-rq', path.join(dist, 'Fleabook-windows-x64.zip'), 'Fleabook'], { cwd: dist });
	}

	log('Done');
	console.log(`  ${app}`);
	if (!skipZip) console.log(`  ${path.join(dist, 'Fleabook-windows-x64.zip')}`);
}

function readmeText() {
	return `Fleabook
========

Turn photos of your stuff into Facebook Marketplace listings.

Getting started
---------------

1. Unzip this folder somewhere you can find it again, such as your Desktop.
   Do not run it from inside the zip file.
2. Double-click Fleabook.exe.
3. A black window opens and stays open. That is the app running - leave it be.
   Your browser opens to http://127.0.0.1:5180 a moment later.
4. To stop Fleabook, close the black window.

Windows may warn that the app is unrecognised, because it is not code-signed.
Choose "More info" and then "Run anyway" if you trust where you got this from.

Connecting it to Claude
-----------------------

Fleabook writes your listings with Claude, so it needs one of these:

  - A Claude subscription. Install the Claude Code app and sign in once.
    Fleabook picks that up automatically and there is nothing extra to pay.

  - An Anthropic API key. Open Settings inside Fleabook and follow the
    instructions there. You add credits up front and each listing costs a
    small amount. No subscription needed.

Where your data lives
---------------------

Listings, photos, and settings are stored in:

  %LOCALAPPDATA%\\Fleabook\\data

Paste that into Explorer's address bar to open it. Nothing is uploaded
anywhere except the photos and text sent to Claude to write each listing.
Deleting the Fleabook folder does not delete your listings; delete the
folder above as well if that is what you want.

Troubleshooting
---------------

"Port 5180 is already in use"
  Fleabook is probably already running. Look for the black window before
  starting a second copy. If there is none, open Task Manager and end any
  leftover node.exe.

The browser did not open
  Fleabook is likely still running. Go to http://127.0.0.1:5180 yourself.
`;
}

main().catch((err) => {
	console.error(`\nBuild failed: ${err.message}`);
	process.exit(1);
});
