import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Dev-only. Level files keep stable ids. Play order lives in order.json. */
function levelSavePlugin(): Plugin {
  const dir = path.resolve('public/levels');
  const orderPath = path.join(dir, 'order.json');
  const fileOf = (id: string) => path.join(dir, `${id}.json`);
  const readBody = (req: import('node:http').IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  const readOrder = (): string[] => {
    if (!fs.existsSync(orderPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(orderPath, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  };
  const writeOrder = (ids: string[]) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(orderPath, `${JSON.stringify(ids)}\n`);
  };
  return {
    name: 'level-save',
    configureServer(server) {
      server.middlewares.use('/__levels', (req, res, next) => {
        const url = req.url ?? '';
        const one = /^\/(\d+)\/?$/.exec(url);
        if (req.method === 'PUT' && (url === '/order' || url === '/order/')) {
          void readBody(req).then((text) => {
            const ids = JSON.parse(text) as unknown;
            if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
              res.statusCode = 400;
              res.end('order must be a string array');
              return;
            }
            writeOrder(ids);
            res.statusCode = 204;
            res.end();
          }).catch((error: unknown) => {
            res.statusCode = 400;
            res.end(error instanceof Error ? error.message : 'bad json');
          });
          return;
        }
        if (req.method === 'POST' && (url === '/' || url === '')) {
          const order = readOrder();
          const used = new Set(order);
          let nextId = 1;
          while (used.has(String(nextId)) || fs.existsSync(fileOf(String(nextId)))) nextId += 1;
          const id = String(nextId);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(fileOf(id), `${JSON.stringify({ screws: [] }, null, 2)}\n`);
          writeOrder([...order, id]);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ id }));
          return;
        }
        if (!one) {
          next();
          return;
        }
        const id = one[1];
        if (req.method === 'PUT') {
          void readBody(req).then((text) => {
            JSON.parse(text);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fileOf(id), text.endsWith('\n') ? text : `${text}\n`);
            res.statusCode = 204;
            res.end();
          }).catch((error: unknown) => {
            res.statusCode = 400;
            res.end(error instanceof Error ? error.message : 'bad json');
          });
          return;
        }
        if (req.method === 'DELETE') {
          const order = readOrder();
          if (!order.includes(id) || order.length <= 1) {
            res.statusCode = 400;
            res.end('keep one level');
            return;
          }
          if (fs.existsSync(fileOf(id))) fs.unlinkSync(fileOf(id));
          writeOrder(order.filter((item) => item !== id));
          res.statusCode = 204;
          res.end();
          return;
        }
        next();
      });
    },
  };
}

/**
 * base: './' is REQUIRED for Capacitor (capacitor:// / file:// asset loading).
 * Absolute /assets/... paths break inside the iOS WebView.
 */
export default defineConfig({
  base: './',
  plugins: [levelSavePlugin()],
  server: {
    host: true,
    port: 5190,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 5190,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: path.resolve('index.html'),
        editor: path.resolve('editor.html'),
      },
    },
  },
  esbuild: {
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
});
