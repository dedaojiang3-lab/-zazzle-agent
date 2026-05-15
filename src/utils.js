import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let config, client;

export async function loadConfig() {
  if (!config) {
    const raw = await fs.readFile(path.join(ROOT, 'config.json'), 'utf-8');
    config = JSON.parse(raw);
  }
  return config;
}

export function getDeepSeekClient() {
  if (!client) {
    const cfg = loadConfigSync();
    client = new OpenAI({
      apiKey: cfg.deepseek.apiKey,
      baseURL: cfg.deepseek.baseUrl,
    });
  }
  return client;
}

function loadConfigSync() {
  const raw = readFileSync(path.join(ROOT, 'config.json'), 'utf-8');
  return JSON.parse(raw);
}

/**
 * Call DeepSeek API
 */
export async function deepseekChat(systemPrompt, userMessage, temperature = 0.7) {
  const ds = getDeepSeekClient();
  const cfg = await loadConfig();

  const response = await ds.chat.completions.create({
    model: cfg.deepseek.model,
    temperature,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  return response.choices[0].message.content;
}

/**
 * Create output directory for this run
 */
export async function createRunDir() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
  const dirName = `${dateStr}_${timeStr}`;
  const dir = path.join(ROOT, 'output', dirName);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, 'designs'), { recursive: true });
  return dir;
}

/**
 * Load a prompt template from prompts/ directory
 */
export async function loadPrompt(name) {
  return fs.readFile(path.join(ROOT, 'prompts', name), 'utf-8');
}

/**
 * Download image as buffer
 */
export async function downloadImage(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

/**
 * Sanitize filename
 */
export function sanitize(str) {
  return str.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 60);
}

/**
 * Log with timestamp
 */
export function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

export { ROOT };
