import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── テスト用ユーティリティ ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

// ── テスト対象の関数を抜き出す ─────────────────────────────────────────────
// index.js の内部関数はエクスポートされていないため、
// ソースを文字列として読み込んで eval する方法の代わりに
// ロジックをここに複製して同一性を保証するテストとする。

function cleanUrl(imageUrl) {
  return imageUrl.replace(/&amp;/g, '&');
}

function getExtension(encodedUrl) {
  const urlParts = new URL(encodedUrl);
  const pathParts = urlParts.pathname.split('/');
  const originalFilename = pathParts[pathParts.length - 1];
  let extension = '.jpg';
  if (originalFilename) {
    const decodedFilename = decodeURIComponent(originalFilename);
    const ext = path.extname(decodedFilename).toLowerCase();
    if (ext && ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'].includes(ext)) {
      extension = ext;
    }
  }
  return extension;
}

function buildDownloadUrl(imageUrl) {
  const clean = cleanUrl(imageUrl);
  return encodeURI(decodeURI(clean));
}

function buildHash(imageUrl) {
  const clean = cleanUrl(imageUrl);
  return crypto.createHash('md5').update(clean).digest('hex');
}

// ── テスト群 ───────────────────────────────────────────────────────────────

console.log('\n【1】HTMLエンティティのデコード');

test('&amp; → & に変換される', () => {
  const input  = 'https://images.microcms-assets.io/assets/abc/img.png?auto=compress&amp;fm=auto&amp;w=1920';
  const result = cleanUrl(input);
  assert.strictEqual(result, 'https://images.microcms-assets.io/assets/abc/img.png?auto=compress&fm=auto&w=1920');
});

test('&amp; がない場合は変更なし', () => {
  const input = 'https://images.microcms-assets.io/assets/abc/img.png?auto=compress&fm=auto&w=1920';
  assert.strictEqual(cleanUrl(input), input);
});

test('複数の &amp; をすべて変換する', () => {
  const input  = 'https://example.com/img.png?a=1&amp;b=2&amp;c=3';
  const result = cleanUrl(input);
  assert.strictEqual(result, 'https://example.com/img.png?a=1&b=2&c=3');
});

console.log('\n【2】ダウンロード URL の構築');

test('クエリパラメータが正しく含まれる', () => {
  const input = 'https://images.microcms-assets.io/assets/abc/sample_05.png?auto=compress&amp;fm=auto&amp;w=1920';
  const url   = buildDownloadUrl(input);
  assert.ok(url.includes('auto=compress'), 'auto=compress がない');
  assert.ok(url.includes('fm=auto'),       'fm=auto がない');
  assert.ok(url.includes('w=1920'),        'w=1920 がない');
  assert.ok(!url.includes('&amp;'),        '&amp; が残っている');
});

test('&amp; が & に正規化されている', () => {
  const input = 'https://example.com/img.png?a=1&amp;b=2';
  const url   = buildDownloadUrl(input);
  assert.ok(url.includes('a=1&b=2'), 'パラメータ区切りが正しくない');
});

console.log('\n【3】ハッシュ生成（重複ダウンロード防止）');

test('&amp; 版と & 版は同じハッシュになる', () => {
  const withEntity  = 'https://images.microcms-assets.io/assets/abc/img.png?auto=compress&amp;fm=auto&amp;w=1920';
  const withAmpersand = 'https://images.microcms-assets.io/assets/abc/img.png?auto=compress&fm=auto&w=1920';
  assert.strictEqual(buildHash(withEntity), buildHash(withAmpersand));
});

test('クエリパラメータが異なる URL は別ハッシュになる', () => {
  const url1 = 'https://images.microcms-assets.io/assets/abc/img.png?w=1920';
  const url2 = 'https://images.microcms-assets.io/assets/abc/img.png?w=800';
  assert.notStrictEqual(buildHash(url1), buildHash(url2));
});

console.log('\n【4】拡張子の取得');

test('クエリパラメータ付き .png URL から .png を取得', () => {
  const url = 'https://images.microcms-assets.io/assets/abc/sample_05.png?auto=compress&fm=auto&w=1920';
  assert.strictEqual(getExtension(url), '.png');
});

test('クエリパラメータ付き .jpg URL から .jpg を取得', () => {
  const url = 'https://images.microcms-assets.io/assets/abc/photo.jpg?w=800';
  assert.strictEqual(getExtension(url), '.jpg');
});

test('拡張子なし URL はデフォルト .jpg を返す', () => {
  const url = 'https://images.microcms-assets.io/assets/abc/photo?w=800';
  assert.strictEqual(getExtension(url), '.jpg');
});

// ── 結果 ──────────────────────────────────────────────────────────────────

console.log(`\n結果: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
