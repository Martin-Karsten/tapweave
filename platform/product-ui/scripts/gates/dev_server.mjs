import { spawn } from 'node:child_process';

const dev_port = 5180;

// The dev server is spawned detached in its own process group so the whole
// `npm -> vite` tree can be terminated; a SIGTERM to npm alone orphans vite
// and keeps the probe's piped stdio (and therefore the probe) alive.
export const start_dev_server = () => {
  const dev_server = spawn('npm', ['run', 'dev'], {
    cwd: new URL('../..', import.meta.url).pathname,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, BROWSER: 'none' },
  });
  dev_server.unref();

  const stop_dev_server = () => {
    try {
      process.kill(-dev_server.pid, 'SIGTERM');
    } catch {
      // The group already exited.
    }
  };

  const wait_for_port = async () => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${dev_port}/`);
        if (response.ok) return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    throw new Error('vite dev server never became ready');
  };

  return { stop_dev_server, wait_for_port };
};
