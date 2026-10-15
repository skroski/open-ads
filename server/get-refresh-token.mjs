// Gera o GOOGLE_ADS_REFRESH_TOKEN com o cliente OAuth (tipo "App para computador")
// e grava direto no server/.env — o valor não aparece no terminal.
// Uso: npm run token   (ou: node --env-file=server/.env server/get-refresh-token.mjs)
// Para pedir só o Google Ads (sem Analytics e Search Console): GOOGLE_SCOPES=adwords npm run token

import { SCOPES, obtainRefreshToken } from './oauth-flow.mjs';
import { updateEnv } from './env-file.mjs';

const { GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET } = process.env;
if (!GOOGLE_ADS_CLIENT_ID || !GOOGLE_ADS_CLIENT_SECRET) {
  console.error('Faltam GOOGLE_ADS_CLIENT_ID ou GOOGLE_ADS_CLIENT_SECRET no server/.env. Rode: npm run setup');
  process.exit(1);
}

const scopes =
  process.env.GOOGLE_SCOPES === 'adwords' ? [SCOPES.ads] : [SCOPES.ads, SCOPES.analytics, SCOPES.searchConsole];

try {
  const token = await obtainRefreshToken({ clientId: GOOGLE_ADS_CLIENT_ID, clientSecret: GOOGLE_ADS_CLIENT_SECRET, scopes });
  await updateEnv({ GOOGLE_ADS_REFRESH_TOKEN: token });
  console.log('✅ Refresh token gravado em server/.env (GOOGLE_ADS_REFRESH_TOKEN).');
  console.log('   Se usa a Vercel, copie o valor do arquivo para as variáveis de ambiente de lá.');
} catch (err) {
  console.error('❌ Falha na autorização:', err.message);
  process.exit(1);
}
