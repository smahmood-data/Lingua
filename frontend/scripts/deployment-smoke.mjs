import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const EXPECTED_TOKEN_KEYS = [
  'expiresAt',
  'model',
  'newSessionExpiresAt',
  'sourceLanguage',
  'systemInstruction',
  'targetLanguage',
  'token',
]

function deploymentOrigin(value) {
  if (!value) {
    throw new Error(
      'Pass the deployment URL as an argument or set LINGUA_DEPLOYMENT_URL.',
    )
  }

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('The deployment URL is not a valid absolute URL.')
  }

  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('Use HTTPS for a deployed smoke check.')
  }

  return new URL('/', url)
}

function validFutureDate(value, now) {
  if (typeof value !== 'string') return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp > now ? timestamp : null
}

export function validateLiveTokenResponse(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('The live-token response is not a JSON object.')
  }

  const keys = Object.keys(body).sort()
  if (JSON.stringify(keys) !== JSON.stringify(EXPECTED_TOKEN_KEYS)) {
    throw new Error('The live-token response has an unexpected field set.')
  }

  if (typeof body.token !== 'string' || !body.token.startsWith('auth_tokens/')) {
    throw new Error('The live-token response is not a constrained token.')
  }
  if (body.sourceLanguage !== 'auto' || body.targetLanguage !== 'en') {
    throw new Error('The live-token response does not preserve the smoke route.')
  }
  if (typeof body.model !== 'string' || body.model.length === 0) {
    throw new Error('The live-token response is missing its model.')
  }
  if (
    typeof body.systemInstruction !== 'string' ||
    body.systemInstruction.length === 0
  ) {
    throw new Error('The live-token response is missing its instruction.')
  }

  const expiresAt = validFutureDate(body.expiresAt, now)
  const newSessionExpiresAt = validFutureDate(body.newSessionExpiresAt, now)
  if (!expiresAt || !newSessionExpiresAt || newSessionExpiresAt > expiresAt) {
    throw new Error('The live-token response has invalid expiry bounds.')
  }

  return {
    model: body.model,
    sourceLanguage: body.sourceLanguage,
    targetLanguage: body.targetLanguage,
    expiresAt: body.expiresAt,
    newSessionExpiresAt: body.newSessionExpiresAt,
  }
}

function safeErrorSummary(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ''
  return ['code', 'error', 'message']
    .map((name) => body[name])
    .filter((value) => typeof value === 'string')
    .map((value) => value.replace(/[\r\n\t]/g, ' ').slice(0, 160))
    .join(': ')
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function runDeploymentSmoke(
  value,
  { fetchImpl = globalThis.fetch, now = Date.now() } = {},
) {
  const baseUrl = deploymentOrigin(value)
  const homepage = await fetchImpl(baseUrl, {
    headers: { Accept: 'text/html' },
    redirect: 'follow',
  })
  if (!homepage.ok) {
    throw new Error(`Homepage returned HTTP ${homepage.status}.`)
  }
  if (!homepage.headers.get('content-type')?.includes('text/html')) {
    throw new Error('Homepage did not return HTML.')
  }
  const html = await homepage.text()
  if (!html.includes('id="root"')) {
    throw new Error('Homepage is not the Lingua Vite shell.')
  }

  const tokenUrl = new URL('/api/live-token?target=en', baseUrl)
  const tokenResponse = await fetchImpl(tokenUrl, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
  })
  const tokenBody = await readJson(tokenResponse)
  if (!tokenResponse.ok) {
    const summary = safeErrorSummary(tokenBody)
    throw new Error(
      `Live-token endpoint returned HTTP ${tokenResponse.status}${summary ? ` (${summary})` : ''}.`,
    )
  }
  if (!tokenResponse.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Live-token endpoint did not return JSON.')
  }
  if (!tokenResponse.headers.get('cache-control')?.includes('no-store')) {
    throw new Error('Live-token response is missing Cache-Control: no-store.')
  }

  const token = validateLiveTokenResponse(tokenBody, now)
  return {
    origin: baseUrl.origin,
    homepageStatus: homepage.status,
    tokenStatus: tokenResponse.status,
    ...token,
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null

if (entryUrl === import.meta.url) {
  const deploymentUrl = process.argv[2] || process.env.LINGUA_DEPLOYMENT_URL
  try {
    const result = await runDeploymentSmoke(deploymentUrl)
    console.log(`Deployment smoke passed for ${result.origin}`)
    console.log(`- Homepage: HTTP ${result.homepageStatus} (Lingua HTML shell)`)
    console.log(
      `- Live token: HTTP ${result.tokenStatus} (constrained ${result.sourceLanguage} → ${result.targetLanguage}, ${result.model})`,
    )
    console.log('- Token value was validated in memory and was not printed.')
  } catch (error) {
    console.error(
      `Deployment smoke failed: ${error instanceof Error ? error.message : 'Unknown error.'}`,
    )
    process.exitCode = 1
  }
}
