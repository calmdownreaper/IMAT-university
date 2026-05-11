import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:4173/index.html';
const GVIZ_PATH_FRAGMENT = '/gviz/tq?tqx=out:json';
const PROJECT_DIR = '/home/joao/siteimat/IMAT-university';

function loadExpectedData() {
  const html = fs.readFileSync(path.join(PROJECT_DIR, 'ranking.html'), 'utf8');
  const match = html.match(/const DATA = \[(.|\n|\r)*?\n\s*\];/);
  if (!match) {
    throw new Error('DATA not found in ranking.html');
  }
  // ranking.html is controlled local source of truth for expected output
  const code = match[0].replace('const DATA =', '').trim().replace(/;$/, '');
  // eslint-disable-next-line no-eval
  return eval(code);
}

function normalizedGvizFromExpected(expected) {
  const cols = [
    'UNI', 'Qs_rep_calc', 'Censis_calc', 'Nat_index_calc', 'Qs_rank_calc', 'THE_rank_calc',
    'SCORE_Q', 'Corte_calc', 'COL_calc', 'QOL_calc', 'city_size', 'Non_EU_Seats',
    'COL_raw', 'QOL_raw', 'Corte_2025', 'Corte_2023'
  ];

  const table = {
    cols: cols.map((label) => ({ id: label, label, type: 'string' })),
    rows: expected.map((row) => ({
      c: cols.map((key) => {
        const value = row[key];
        return { v: value == null ? null : String(value) };
      })
    }))
  };

  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table })});`;
}

function invalidGvizPayload() {
  const cols = [
    'Posição', 'Score Qualidade', 'QS Reputação', 'Rank QS (Med)', 'Rank THE (Med)',
    'Censis', 'Nature Index', 'Instituição', 'NUMBEO COL', 'LAB24 QoL', 'Non-EU Seats',
    'Non-EU Cut-off (2025)', 'Non-EU Cut-off (2023)', 'C/O'
  ];

  const table = {
    cols: cols.map((label) => ({ id: label, label, type: 'string' })),
    rows: [
      { c: ['UNI', 'Qs_rep_calc', 'Censis_calc', 'Nat_index_calc', 'Qs_rank_calc', 'THE_rank_calc', 'SCORE_Q', 'Corte_calc', 'COL_calc', 'QOL_calc', 'city_size', '', '', ''].map(v => ({ v })) },
      { c: ['999', '999', '999', '999', '999', '999', '999', '999', '999', '999', '999', '', '', ''].map(v => ({ v })) },
      { c: ['68,7399679', '100', '32,051', '82,015', '99,014', '73,802', '83,422', '61,3', '62,6', '68,5', '2', '', '', ''].map(v => ({ v })) }
    ]
  };

  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table })});`;
}

function normalizedMissingCutoffPayload(expected) {
  const clone = expected.map((row) => ({ ...row }));
  // Force one high-score row with missing cutoffs to validate "N/A" and no "#0"
  clone[0] = {
    ...clone[0],
    UNI: 'Test Missing Cutoff University',
    SCORE_Q: 100,
    COL_calc: 100,
    QOL_calc: 100,
    Corte_calc: 100,
    Corte_2025: null,
    Corte_2023: null
  };

  return normalizedGvizFromExpected(clone);
}

function almostEqual(a, b, tol = 1e-6) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tol;
}

function compareToExpected(actualRows, expectedRows, { strictNames = true } = {}) {
  const errors = [];
  const actualByUni = new Map(actualRows.map((row) => [row.UNI, row]));

  if (strictNames) {
    if (actualRows.length !== expectedRows.length) {
      errors.push(`length mismatch: actual=${actualRows.length} expected=${expectedRows.length}`);
    }

    for (const row of expectedRows) {
      if (!actualByUni.has(row.UNI)) {
        errors.push(`missing university: ${row.UNI}`);
      }
    }
  }

  const fields = [
    'SCORE_Q', 'Corte_calc', 'COL_calc', 'QOL_calc',
    'Non_EU_Seats', 'COL_raw', 'QOL_raw', 'Corte_2025', 'Corte_2023'
  ];

  for (const expected of expectedRows) {
    const actual = actualByUni.get(expected.UNI);
    if (!actual) continue;

    for (const field of fields) {
      const a = actual[field];
      const b = expected[field];
      if (field === 'Non_EU_Seats') {
        if (a !== b) {
          errors.push(`${expected.UNI}: ${field} actual=${a} expected=${b}`);
        }
      } else if (!almostEqual(a, b, 1e-4)) {
        errors.push(`${expected.UNI}: ${field} actual=${a} expected=${b}`);
      }
    }
  }

  return errors;
}

async function collectPageState(page) {
  await page.waitForFunction(() => typeof DATA !== 'undefined' && Array.isArray(DATA) && DATA.length > 0, null, { timeout: 20000 });

  return page.evaluate(() => {
    showResults();

    const rows = DATA.map((r) => ({
      UNI: r.UNI,
      SCORE_Q: r.SCORE_Q,
      Corte_calc: r.Corte_calc,
      COL_calc: r.COL_calc,
      QOL_calc: r.QOL_calc,
      Non_EU_Seats: r.Non_EU_Seats,
      COL_raw: r.COL_raw,
      QOL_raw: r.QOL_raw,
      Corte_2025: r.Corte_2025,
      Corte_2023: r.Corte_2023
    }));

    const cards = [...document.querySelectorAll('.result-card')].map((card) => ({
      uni: card.querySelector('.result-uni-name')?.textContent?.trim() || '',
      score: Number.parseFloat(card.querySelector('.result-score')?.textContent?.trim() || 'NaN'),
      corteText: card.querySelector('.detail-item:nth-child(4) .detail-value')?.textContent?.trim() || ''
    }));

    const numericNames = rows.filter((row) => /^\s*[\d.,\s]+\s*$/.test(row.UNI)).map((row) => row.UNI);
    const outOfRange = rows.filter((row) => [row.SCORE_Q, row.Corte_calc, row.COL_calc, row.QOL_calc].some((v) => !Number.isFinite(v) || v < 0 || v > 100)).map((row) => row.UNI);

    return { rows, cards, numericNames, outOfRange };
  });
}

async function runCase(browser, name, expected, routeFactory, validator) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const logs = [];

  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

  if (routeFactory) {
    await routeFactory(page, expected);
  }

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  const state = await collectPageState(page);

  const errors = [];

  if (state.numericNames.length > 0) {
    errors.push(`numeric UNI names found: ${state.numericNames.join(', ')}`);
  }
  if (state.outOfRange.length > 0) {
    errors.push(`out of range metrics in: ${state.outOfRange.join(', ')}`);
  }
  if (state.cards.length !== 5) {
    errors.push(`top5 cards expected=5 actual=${state.cards.length}`);
  }
  if (state.cards.some((card) => !Number.isFinite(card.score) || card.score < 0 || card.score > 100)) {
    errors.push('card score out of 0-100 range');
  }
  if (state.cards.some((card) => card.corteText.includes('#0'))) {
    errors.push('card contains invalid corte rank #0');
  }

  if (validator) {
    errors.push(...validator(state, logs));
  }

  await context.close();

  return { name, errors, state, logs };
}

(async () => {
  const expected = loadExpectedData();
  const browser = await chromium.launch({ headless: true });

  const cases = [
    {
      name: 'live-gviz',
      routeFactory: null,
      validator: (state) => compareToExpected(state.rows, expected, { strictNames: true })
    },
    {
      name: 'gviz-invalid-fallback-csv',
      routeFactory: async (page) => {
        await page.route(`**${GVIZ_PATH_FRAGMENT}**`, (route) => {
          route.fulfill({
            status: 200,
            contentType: 'text/javascript',
            body: invalidGvizPayload()
          });
        });
      },
      validator: (state, logs) => {
        const errors = compareToExpected(state.rows, expected, { strictNames: true });
        if (!logs.some((line) => line.includes('Failed source Google Visualization API'))) {
          errors.push('expected gviz failure log not found');
        }
        if (!logs.some((line) => line.includes('Data loaded from local fallback'))) {
          errors.push('expected local fallback load log not found');
        }
        return errors;
      }
    },
    {
      name: 'gviz-normalized-schema',
      routeFactory: async (page, expectedRows) => {
        await page.route(`**${GVIZ_PATH_FRAGMENT}**`, (route) => {
          route.fulfill({
            status: 200,
            contentType: 'text/javascript',
            body: normalizedGvizFromExpected(expectedRows)
          });
        });
      },
      validator: (state) => compareToExpected(state.rows, expected, { strictNames: true })
    },
    {
      name: 'gviz-network-fail-fallback-csv',
      routeFactory: async (page) => {
        await page.route(`**${GVIZ_PATH_FRAGMENT}**`, (route) => route.abort());
      },
      validator: (state, logs) => {
        const errors = compareToExpected(state.rows, expected, { strictNames: true });
        if (!logs.some((line) => line.includes('Data loaded from local fallback'))) {
          errors.push('expected local fallback after network fail not found');
        }
        return errors;
      }
    },
    {
      name: 'missing-cutoff-shows-na-not-hash0',
      routeFactory: async (page, expectedRows) => {
        await page.route(`**${GVIZ_PATH_FRAGMENT}**`, (route) => {
          route.fulfill({
            status: 200,
            contentType: 'text/javascript',
            body: normalizedMissingCutoffPayload(expectedRows)
          });
        });
      },
      validator: (state) => {
        const errors = [];
        const hasNA = state.cards.some((card) => card.corteText === 'N/A');
        if (!hasNA) {
          errors.push('expected at least one N/A corte card');
        }
        return errors;
      }
    }
  ];

  const results = [];
  for (const testCase of cases) {
    const result = await runCase(browser, testCase.name, expected, testCase.routeFactory, testCase.validator);
    results.push(result);
  }

  await browser.close();

  const failed = results.filter((result) => result.errors.length > 0);

  for (const result of results) {
    const status = result.errors.length === 0 ? 'PASS' : 'FAIL';
    console.log(`\n[${status}] ${result.name}`);
    if (result.errors.length > 0) {
      result.errors.forEach((error) => console.log(`  - ${error}`));
    }
    const preview = result.state.cards.slice(0, 2).map((card) => `${card.uni} (${card.score})`).join(' | ');
    console.log(`  cards: ${preview}`);
  }

  if (failed.length > 0) {
    process.exit(1);
  }
})();
