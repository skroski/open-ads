// Gera os MP3s versionados da ajuda. É uma tarefa manual de release: o painel
// publicado nunca recebe a chave do Fish Audio nem faz síntese ao ser aberto.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const journeyPath = path.join(root, 'web', 'src', 'app', 'help', 'onboarding-journey.json');
const catalog = JSON.parse(await readFile(journeyPath, 'utf8'));
const key = process.env.FISH_AUDIO_API_KEY;
const referenceId = process.env.FISH_AUDIO_REFERENCE_ID;
const model = process.env.FISH_AUDIO_MODEL || 's2.1-pro-free';
const force = process.argv.includes('--force');
const requestedStep = process.argv.find((arg) => arg.startsWith('--step='))?.slice('--step='.length);

if (!key) throw new Error('FISH_AUDIO_API_KEY não está definida. Preencha-a no seu server/.env e tente novamente.');
if (!referenceId) throw new Error('FISH_AUDIO_REFERENCE_ID não está definida. Escolha uma voz do Fish Audio no seu server/.env.');
if (!['s2.1-pro-free', 's2.1-pro', 's2-pro'].includes(model)) throw new Error('FISH_AUDIO_MODEL inválido. Use s2.1-pro-free, s2.1-pro ou s2-pro.');

const steps = catalog.journeys.flatMap((journey) => journey.steps.map((step) => ({ ...step, journey })));
const selectedSteps = steps.filter((step) => !requestedStep || step.id === requestedStep);
if (!selectedSteps.length) throw new Error(`Nenhuma etapa chamada "${requestedStep}" foi encontrada.`);

for (const step of selectedSteps) {
  const output = path.join(root, 'web', 'public', 'open-help', `v${step.journey.version}`);
  await mkdir(output, { recursive: true });
  const destination = path.join(output, `${step.id}.mp3`);
  try {
    await readFile(destination);
    if (!force) {
      console.log(`Mantido: ${path.relative(root, destination)}`);
      continue;
    }
  } catch {
    // O arquivo ainda não existe.
  }

  console.log(`Gerando: ${step.id}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response;
  try {
    response = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        model,
      },
      body: JSON.stringify({
        text: step.narration,
        reference_id: referenceId,
        language: catalog.language,
        format: 'mp3',
        sample_rate: 44100,
        mp3_bitrate: 128,
        latency: 'normal',
        temperature: 0.7,
        top_p: 0.7,
        chunk_length: 200,
        normalize: true,
        condition_on_previous_chunks: true,
        prosody: { speed: 1, volume: 0, normalize_loudness: true },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = typeof body?.message === 'string' ? `: ${body.message}` : '';
    } catch {
      // Não expõe o corpo bruto do provedor.
    }
    throw new Error(`Fish Audio respondeu ${response.status}${detail}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('audio/')) throw new Error(`Fish Audio não retornou áudio para a etapa "${step.id}".`);
  const audio = new Uint8Array(await response.arrayBuffer());
  if (!audio.byteLength) throw new Error(`Fish Audio retornou áudio vazio para a etapa "${step.id}".`);
  const temporary = `${destination}.tmp`;
  try {
    await writeFile(temporary, audio);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

console.log(`Áudios da ajuda prontos. Revise os MP3s antes de publicar.`);
