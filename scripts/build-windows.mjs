#!/usr/bin/env node
// Package Fleabook for Windows.
//
// Runs on Linux (or Windows) and produces three things in `dist-windows/`: the
// unpacked `Fleabook/` folder, an installer built from it, and a zip of it for
// anyone who would rather not install anything. Nothing here touches the Docker
// build — the Linux deployment path is `docker compose up -d --build` and is
// unaffected by anything in this file.
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
//   node scripts/build-windows.mjs                  full build
//   node scripts/build-windows.mjs --no-zip         skip the archive step
//   node scripts/build-windows.mjs --no-installer   skip the installer step

import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

const launcher = path.join(root, 'windows', 'launcher');
const resources = path.join(root, 'windows', 'resources');
const installerScript = path.join(root, 'windows', 'installer', 'fleabook.nsi');

const skipZip = process.argv.includes('--no-zip');
const skipInstaller = process.argv.includes('--no-installer');

function log(step) {
	console.log(`\n▶ ${step}`);
}

function run(cmd, args, opts = {}) {
	execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
}

// null when makensis is not on PATH, so the check can happen up front rather
// than after the several minutes the rest of the build takes.
function makensisVersion() {
	try {
		return execFileSync('makensis', ['-VERSION'], { encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
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

	// Checked before the build rather than after it: makensis is the one tool
	// here that is not already required for `npm run dev`, and finding out it is
	// missing after the npm install and the runtime download wastes minutes.
	const nsis = skipInstaller ? null : makensisVersion();
	if (!skipInstaller && !nsis) {
		throw new Error(
			'makensis is not on PATH, so the installer cannot be built.\n' +
				'  Install it with:  sudo apt install nsis\n' +
				'  Or skip it with:  node scripts/build-windows.mjs --no-installer'
		);
	}

	// NSIS wants a four-part version, and package.json is the only place a
	// version is recorded. A prerelease suffix would not survive the conversion,
	// so drop it rather than emit something makensis rejects halfway through.
	const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
	const version = (pkg.version ?? '0.0.0').split('-')[0];

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
	// -H=windowsgui puts the launcher in the GUI subsystem, so double-clicking it
	// does not flash up a console. That is also why the launcher can no longer
	// print anything: everything user-facing is a message box, everything else
	// goes to %LOCALAPPDATA%\Fleabook\logs.
	//
	// The icon, the version block and the DPI/UAC manifest come from the
	// committed resource_windows_amd64.syso, which the Go toolchain links in by
	// filename. See windows/resources/README.md to regenerate it.
	run(
		'go',
		[
			'build',
			'-trimpath',
			'-ldflags',
			'-s -w -H=windowsgui',
			'-o',
			path.join(app, 'Fleabook.exe'),
			'.'
		],
		{
			cwd: launcher,
			env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' }
		}
	);

	log('Assembling');
	await cp(path.join(root, 'build'), path.join(app, 'build'), { recursive: true });
	await writeFile(path.join(app, 'README.txt'), readmeText(), 'utf8');
	// package-lock.json is only needed for the install above.
	await rm(path.join(app, 'package-lock.json'), { force: true });

	const setup = path.join(dist, 'Fleabook-Setup.exe');
	if (!skipInstaller) {
		log(`Building the installer (${nsis.split('\n')[0]})`);
		// Host-side paths are handed over as forward slashes: makensis on Linux
		// does not treat a backslash as a separator when reading build files.
		const forward = (p) => p.split(path.sep).join('/');
		run('makensis', [
			'-V2',
			`-DPAYLOAD=${forward(app)}`,
			`-DOUTFILE=${forward(setup)}`,
			`-DRESOURCES=${forward(resources)}`,
			`-DLICENSEFILE=${forward(path.join(root, 'LICENSE'))}`,
			`-DVERSION=${version}`,
			installerScript
		]);
	}

	if (!skipZip) {
		log('Zipping');
		run('zip', ['-rq', path.join(dist, 'Fleabook-windows-x64.zip'), 'Fleabook'], { cwd: dist });
	}

	log('Done');
	if (!skipInstaller) console.log(`  ${setup}  (what to hand to people)`);
	console.log(`  ${app}`);
	if (!skipZip) console.log(`  ${path.join(dist, 'Fleabook-windows-x64.zip')}`);
}

function readmeText() {
	return `Fleabook
========

Turn photos of your stuff into Facebook Marketplace listings.

This is the portable copy. If you would rather have Fleabook in your Start
menu, use Fleabook-Setup.exe instead - it installs for you only and does not
ask for an administrator password.

Getting started
---------------

1. Unzip this folder somewhere you can find it again, such as your Desktop.
   Do not run it from inside the zip file.
2. Double-click Fleabook.exe.
3. Fleabook opens in its own window. The first start takes a few seconds.
4. To stop Fleabook, close the window.

Windows may warn that the app is unrecognised, because it is not code-signed.
Choose "More info" and then "Run anyway" if you trust where you got this from.

Fleabook draws its window with the Microsoft Edge WebView2 Runtime, which is
already part of Windows 11 and of most Windows 10 machines. The installer adds
it if it is missing; this portable copy cannot, so if it is not there Fleabook
falls back to opening in your browser and tells you so.

Connecting it to Claude
-----------------------

Fleabook writes your listings with Claude, so it needs one of these. Open
Settings inside Fleabook and set up whichever you have - both are done from
that page, and neither needs a command prompt.

  - A Claude subscription. Choose "Sign in with Claude". A sign-in page opens
    in your browser; approve it, then paste the code it gives you back into
    Fleabook. Nothing extra to pay.

    Signing in to the separate Claude desktop app does NOT sign in Fleabook.
    The two keep their sign-ins apart, so do this one here even if that app
    already knows who you are.

  - An Anthropic API key. Paste it into the box on the same page. You add
    credits up front and each listing costs a small amount. No subscription
    needed.

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
  Fleabook is probably already running. Look for its window in the taskbar
  before starting a second copy. If there is none, open Task Manager and end
  any leftover Fleabook.exe.

Nothing happens when you double-click
  There is no console window by design, so a failure that happens before the
  window appears shows up as a message box - and, either way, in the log:

    %LOCALAPPDATA%\\Fleabook\\logs\\fleabook.log
`;
}

main().catch((err) => {
	console.error(`\nBuild failed: ${err.message}`);
	process.exit(1);
});
