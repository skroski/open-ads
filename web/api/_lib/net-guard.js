// Proteção contra SSRF para o leitor de páginas.
// Só aceita destinos públicos: nada de rede interna, loopback, link-local ou metadados de nuvem.
// A checagem acontece no momento da conexão (lookup), o que fecha a brecha de DNS rebinding.

import dns from 'node:dns';
import net from 'node:net';

const blocked = new net.BlockList();

[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].forEach(([addr, prefix]) => blocked.addSubnet(addr, prefix, 'ipv4'));

[
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
].forEach(([addr, prefix]) => blocked.addSubnet(addr, prefix, 'ipv6'));

export function isPublicIp(ip) {
  const family = net.isIP(ip);
  if (!family) return false;
  if (family === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.startsWith('::ffff:') ? lower.slice(7) : null;
    if (mapped && net.isIPv4(mapped)) return isPublicIp(mapped);
    return !blocked.check(ip, 'ipv6');
  }
  return !blocked.check(ip, 'ipv4');
}

/** `lookup` para https.request: resolve o nome e só entrega endereços públicos. */
export function safeLookup(hostname, options, callback) {
  const opts = typeof options === 'function' ? {} : (options ?? {});
  const cb = typeof options === 'function' ? options : callback;
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return cb(err);
    const allowed = addresses.filter((a) => isPublicIp(a.address));
    if (!allowed.length) return cb(new Error('Endereço de destino não permitido.'));
    if (opts.all) return cb(null, allowed);
    return cb(null, allowed[0].address, allowed[0].family);
  });
}

/** Host sem "www.", em minúsculas. */
export function bareHost(host) {
  return String(host ?? '')
    .toLowerCase()
    .replace(/^www\./, '');
}

/** O host é igual a um permitido, ou subdomínio dele. */
export function hostAllowed(host, allowed) {
  const h = bareHost(host);
  if (!h) return false;
  for (const raw of allowed) {
    const a = bareHost(raw);
    if (a && (h === a || h.endsWith(`.${a}`))) return true;
  }
  return false;
}

/** Valida a URL pedida. Devolve a URL normalizada ou lança Error com uma mensagem amigável. */
export function validateTarget(raw) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('URL inválida.');
  }
  if (url.protocol !== 'https:') throw new Error('Só páginas https são auditadas.');
  if (url.username || url.password) throw new Error('URL com credenciais não é permitida.');
  if (url.port && url.port !== '443') throw new Error('Só a porta padrão (443) é permitida.');
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('Endereços IP não são permitidos; use o domínio.');
  if (!url.hostname.includes('.')) throw new Error('Domínio inválido.');
  url.hash = '';
  return url;
}
