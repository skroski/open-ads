// Testes dos utilitários de segurança e de leitura de HTML. Rodam com: node --test api/_lib
import test from 'node:test';
import assert from 'node:assert/strict';
import { bareHost, hostAllowed, isPublicIp, validateTarget } from './net-guard.js';
import { extractAudit, decodeEntities } from './html.js';

test('isPublicIp recusa endereços internos e aceita públicos', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.16.5.5', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '142.250.78.14', '2607:f8b0:4004:c07::65', '::ffff:8.8.8.8']) {
    assert.equal(isPublicIp(ip), true, ip);
  }
  assert.equal(isPublicIp('não é ip'), false);
});

test('validateTarget exige https, porta padrão e domínio', () => {
  assert.equal(validateTarget('https://exemplo.com.br/ia/#x').toString(), 'https://exemplo.com.br/ia/');
  assert.throws(() => validateTarget('http://exemplo.com.br'), /https/);
  assert.throws(() => validateTarget('https://exemplo.com.br:8443/'), /porta/);
  assert.throws(() => validateTarget('https://user:pw@exemplo.com.br/'), /credenciais/);
  assert.throws(() => validateTarget('https://127.0.0.1/'), /IP/);
  assert.throws(() => validateTarget('https://[::1]/'), /IP/);
  assert.throws(() => validateTarget('https://localhost/'), /Domínio/);
  assert.throws(() => validateTarget('javascript:alert(1)'), /https|inválida/i);
});

test('hostAllowed aceita o domínio e subdomínios, e recusa parecidos', () => {
  const allowed = new Set(['exemplo.com.br']);
  assert.equal(hostAllowed('www.exemplo.com.br', allowed), true);
  assert.equal(hostAllowed('blog.exemplo.com.br', allowed), true);
  assert.equal(hostAllowed('exemplo.com.br.evil.com', allowed), false);
  assert.equal(hostAllowed('notexemplo.com.br', allowed), false);
  assert.equal(bareHost('WWW.Site.com'), 'site.com');
});

test('extractAudit lê título, h1, formulário, WhatsApp e etiquetas', () => {
  const html = `<!doctype html><html lang="pt-BR"><head>
    <title>Chatbot para clínicas &amp; hospitais | Acme</title>
    <meta name="viewport" content="width=device-width">
    <meta name="description" content="Atendimento automático no WhatsApp">
    <link rel="canonical" href="https://exemplo.com.br/">
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"></script>
    <script>var secret = "<h1>não é título</h1>";</script></head>
    <body><h1>IA para clínicas odontológicas</h1><h2>Como funciona</h2>
    <a href="https://wa.me/5511999999999">Falar no WhatsApp</a><a href="tel:+551133334444">Ligar</a>
    <form action="/c"><input name="a"></form><p>Texto de exemplo com algumas palavras aqui.</p></body></html>`;
  const a = extractAudit(html);
  assert.equal(a.title, 'Chatbot para clínicas & hospitais | Acme');
  assert.equal(a.metaDescription, 'Atendimento automático no WhatsApp');
  assert.deepEqual(a.h1, ['IA para clínicas odontológicas']);
  assert.deepEqual(a.h2, ['Como funciona']);
  assert.equal(a.forms, 1);
  assert.equal(a.whatsappLinks, 1);
  assert.equal(a.telLinks, 1);
  assert.equal(a.hasViewport, true);
  assert.equal(a.hasCanonical, true);
  assert.equal(a.noindex, false);
  assert.equal(a.lang, 'pt-BR');
  assert.ok(a.trackingTags.includes('gtag'));
  assert.ok(a.wordCount > 5);
});

test('extractAudit detecta noindex e página sem medição', () => {
  const a = extractAudit('<html><head><meta name="robots" content="noindex, nofollow"><title>x</title></head><body>oi</body></html>');
  assert.equal(a.noindex, true);
  assert.deepEqual(a.trackingTags, []);
  assert.equal(a.hasViewport, false);
});

test('decodeEntities', () => {
  assert.equal(decodeEntities('A &amp; B &#233; &nbsp;C'), 'A & B é  C');
});
