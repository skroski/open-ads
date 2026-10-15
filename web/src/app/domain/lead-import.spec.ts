import {
  SAMPLE_CSV,
  guessMapping,
  normalizeRows,
  observedSalesCycleDays,
  parseCsv,
  parseDate,
  parseNumber,
  parseStatus,
} from './lead-import';
import { Lead } from './models';

describe('parseCsv', () => {
  it('detecta ponto e vírgula e respeita aspas', () => {
    const rows = parseCsv('a;b;c\n1;"x;y";3\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x;y', '3'],
    ]);
  });

  it('aceita BOM, CRLF, aspas escapadas e linhas vazias', () => {
    const rows = parseCsv('﻿nome,obs\r\n"Ana","disse ""oi"""\r\n\r\n');
    expect(rows).toEqual([
      ['nome', 'obs'],
      ['Ana', 'disse "oi"'],
    ]);
  });
});

describe('valores', () => {
  it('lê números em formato brasileiro e internacional', () => {
    expect(parseNumber('R$ 1.234,56')).toBe(1234.56);
    expect(parseNumber('1234.56')).toBe(1234.56);
    expect(parseNumber('3.000')).toBe(3000);
    expect(parseNumber('0.500')).toBe(0.5);
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('50%')).toBe(50);
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('abc')).toBeUndefined();
  });

  it('lê datas em vários formatos', () => {
    expect(parseDate('2026-10-13T10:00:00Z')).toBe('2026-10-13');
    expect(parseDate('13/10/2026 14:30')).toBe('2026-10-13');
    expect(parseDate('3-4-26')).toBe('2026-04-03');
    expect(parseDate('amanhã')).toBeUndefined();
  });

  it('traduz etapas do CRM sem confundir "desqualificado" com "qualificado"', () => {
    expect(parseStatus('Qualificado')).toBe('QUALIFIED');
    expect(parseStatus('Desqualificado')).toBe('DISQUALIFIED');
    expect(parseStatus('Lead sem perfil')).toBe('DISQUALIFIED');
    expect(parseStatus('Negócio ganho')).toBe('WON');
    expect(parseStatus('Proposta enviada')).toBe('PROPOSAL');
    expect(parseStatus('Perdido')).toBe('LOST');
    expect(parseStatus('Novo')).toBe('OPEN');
  });
});

describe('guessMapping', () => {
  it('reconhece colunas comuns e nunca mapeia dados pessoais', () => {
    const headers = ['Nome', 'E-mail', 'Telefone', 'Data de criação', 'Etapa', 'Campanha', 'Valor da venda', 'Data da venda', 'Motivo da perda'];
    const m = guessMapping(headers);
    expect(m.createdAt).toBe(3);
    expect(m.status).toBe(4);
    expect(m.campaign).toBe(5);
    expect(m.value).toBe(6);
    expect(m.wonAt).toBe(7);
    expect(m.lostReason).toBe(8);
    const used = Object.values(m).filter((i) => i >= 0);
    expect(used).not.toContain(0);
    expect(used).not.toContain(1);
    expect(used).not.toContain(2);
  });

  it('o exemplo do modelo é totalmente reconhecido', () => {
    const rows = parseCsv(SAMPLE_CSV);
    const m = guessMapping(rows[0]);
    expect(m.createdAt).toBeGreaterThanOrEqual(0);
    expect(m.status).toBeGreaterThanOrEqual(0);
    expect(m.campaign).toBeGreaterThanOrEqual(0);
    expect(m.value).toBeGreaterThanOrEqual(0);
    expect(m.wonAt).toBeGreaterThanOrEqual(0);
  });
});

describe('normalizeRows', () => {
  const rows = parseCsv(SAMPLE_CSV);
  const m = guessMapping(rows[0]);
  const result = normalizeRows(rows.slice(1), m);

  it('importa as linhas do exemplo com os tipos certos', () => {
    expect(result.leads).toHaveLength(3);
    const won = result.leads[0];
    expect(won.status).toBe('WON');
    expect(won.value).toBe(3000);
    expect(won.marginPct).toBe(50);
    expect(won.wonAt).toBe('2026-10-02');
    expect(result.leads[2].status).toBe('DISQUALIFIED');
    expect(result.leads[2].lostReason).toBe('sem perfil');
  });

  it('só guarda valor para vendas fechadas', () => {
    const r = normalizeRows([['2026-09-20', 'qualificado', '500']], { ...m, createdAt: 0, status: 1, value: 2 });
    expect(r.leads[0].value).toBeUndefined();
  });

  it('rejeita linha sem data e avisa venda sem valor', () => {
    const r = normalizeRows(
      [
        ['', 'ganho'],
        ['2026-09-20', 'ganho'],
      ],
      { ...m, createdAt: 0, status: 1, value: -1, wonAt: -1 },
    );
    expect(r.leads).toHaveLength(1);
    expect(r.issues.map((i) => i.line)).toEqual([2, 3]);
    expect(r.issues[1].message).toContain('Venda sem valor');
  });
});

describe('observedSalesCycleDays', () => {
  it('mede dias do primeiro contato até a venda', () => {
    const l = (createdAt: string, wonAt: string): Lead => ({
      id: createdAt,
      accountId: 'a',
      createdAt,
      status: 'WON',
      wonAt,
    });
    expect(observedSalesCycleDays([l('2026-09-01', '2026-09-11'), l('2026-09-05', '2026-10-05')])).toEqual([10, 30]);
  });
});
