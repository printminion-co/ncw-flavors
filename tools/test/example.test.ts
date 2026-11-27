import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'yaml';
import { cpSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, build, configAsNextcloudSeesIt, hasPhp, makeFlavorsRoot, makeServerTree, readZip, resolveReport, runCli, tempDir, text } from './helpers.ts';

// These tests read the real flavors committed on this branch, on purpose: they are the only ones that do.

test('the real flavor1 resolves, extends the upstream base and activates both app folders', () => {
  const report = resolveReport(REPO_ROOT, 'flavor1');
  assert.deepEqual(report.app_folders, ['apps-upstream', 'apps-flavor1']);
  for (const id of ['contacts', 'calendar', 'tasks', 'notes']) {
    assert.equal(report.apps[id], 'default', id);
  }
  // groupfolders cannot be enabled by `occ maintenance:install` (its migration needs the app to be loaded), so the
  // script enables it after the install
  assert.equal(report.apps.groupfolders, 'available');
  assert.deepEqual(report.enable_after_install, ['groupfolders']);
  // common wins over upstream-33
  assert.equal(report.apps.files, 'always');
  assert.equal(report.apps.workflowengine, 'removed');
  assert.equal(report.apps.firstrunwizard, 'removed');
  assert.equal(report.apps.support, 'removed');
  assert.equal(report.apps.demo, undefined);
});

const OFFICIAL_53 = [
  'activity', 'admin_audit', 'app_api', 'bruteforcesettings', 'circles', 'cloud_federation_api', 'comments',
  'contactsinteraction', 'dashboard', 'dav', 'encryption', 'federatedfilesharing', 'federation', 'files',
  'files_downloadlimit', 'files_external', 'files_pdfviewer', 'files_reminders', 'files_sharing', 'files_trashbin',
  'files_versions', 'firstrunwizard', 'logreader', 'lookup_server_connector', 'nextcloud_announcements',
  'notifications', 'oauth2', 'password_policy', 'photos', 'privacy', 'profile', 'provisioning_api',
  'recommendations', 'related_resources', 'serverinfo', 'settings', 'sharebymail', 'support', 'survey_client',
  'suspicious_login', 'systemtags', 'text', 'theming', 'twofactor_backupcodes', 'twofactor_nextcloud_notification',
  'twofactor_totp', 'updatenotification', 'user_ldap', 'user_status', 'viewer', 'weather_status',
  'webhook_listeners', 'workflowengine',
];

test('the real base upstream-33 lists exactly the 53 apps of the official 33.0.9 archive', () => {
  const manifest = parse(readFileSync(join(REPO_ROOT, 'bases/upstream-33/flavor.yaml'), 'utf8')) as {
    app_dirs: string[];
    apps: Record<string, string>;
  };
  assert.equal(OFFICIAL_53.length, 53);
  assert.deepEqual(Object.keys(manifest.apps).sort(), [...OFFICIAL_53].sort());
  assert.deepEqual(manifest.app_dirs, ['apps-upstream']);
  for (const mode of Object.values(manifest.apps)) assert.ok(['always', 'default', 'available', 'removed'].includes(mode));
});

test('the real flavor1 inherits the IONOS theme from the base common and enforces it', () => {
  const report = resolveReport(REPO_ROOT, 'flavor1');
  assert.deepEqual(report.themes, ['ionos']);
  assert.equal(report.enforce_theme, 'ionos');
  assert.deepEqual(Object.keys(report.config_files), [
    '10-core.config.php', '11-theme.config.php', '12-mail.config.php', '13-clients.config.php', '50-flavor.config.php',
  ]);
  const manifest = parse(readFileSync(join(REPO_ROOT, 'bases/common/flavor.yaml'), 'utf8')) as { themes: string[]; enforce_theme: string };
  assert.deepEqual(manifest.themes, ['ionos']);
  assert.equal(manifest.enforce_theme, 'ionos');
  // not in the base that only classifies apps
  assert.equal('themes' in (parse(readFileSync(join(REPO_ROOT, 'bases/upstream-33/flavor.yaml'), 'utf8')) as object), false);
});

test('the real base config activates the theme folder and the mail template class', { skip: !hasPhp && 'php is not installed' }, () => {
  const root = makeFlavorsRoot({ 'flavors/f/flavor.yaml': 'extends: [common]\n' });
  cpSync(join(REPO_ROOT, 'bases/common'), join(root, 'bases/common'), { recursive: true });
  cpSync(join(REPO_ROOT, 'themes'), join(root, 'themes'), { recursive: true });
  const result = build({ flavorsRoot: root, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());
  assert.equal(configAsNextcloudSeesIt(zip, 'config/11-theme.config.php'), '{"theme":"ionos"}');
  assert.equal(configAsNextcloudSeesIt(zip, 'config/12-mail.config.php'), '{"mail_template_class":"OC\\\\Ncw\\\\Mail\\\\IonosEMailTemplate"}');
  assert.equal(
    configAsNextcloudSeesIt(zip, 'config/01-themes.config.php'),
    '{"ncw.themes":["OC\\\\Ncw\\\\Themes\\\\IonosTheme"],"enforce_theme":"ionos"}',
  );
  // the classes the config names are at the path the server's PSR-4 autoloader for OC\ looks them up, and declare that class
  for (const fqcn of ['OC\\Ncw\\Themes\\IonosTheme', 'OC\\Ncw\\Mail\\IonosEMailTemplate']) {
    const source = text(zip, `lib/private/${fqcn.slice('OC\\'.length).replaceAll('\\', '/')}.php`);
    const declared = `${/^namespace (.+);$/m.exec(source)?.[1]}\\${/^class (\w+)/m.exec(source)?.[1]}`;
    assert.equal(declared, fqcn);
  }
  assert.ok(zip.has('themes/ionos/fonts/OpenSans-Variable.ttf'));
  assert.ok(zip.has('themes/ionos/fonts/OFL.txt'));
  assert.equal(runCli(['validate', '--flavors', root, '--flavor', 'f', '--artifact', result.stdout.trim()]).status, 0);
});

test('the brand values of the IONOS theme are in IonosTheme.php only: the CSS and the mail template hold no color', () => {
  const hex = /#[0-9a-fA-F]{3,8}\b/;
  const cssFolder = join(REPO_ROOT, 'themes/ionos/assets/css');
  const cssFiles = readdirSync(cssFolder);
  assert.ok(cssFiles.length >= 3, 'the per-app overrides: login, files and one more');
  for (const file of cssFiles) assert.equal(hex.test(readFileSync(join(cssFolder, file), 'utf8')), false, file);
  // the mail template names the stock colors it replaces, and white; nothing else
  const mail = readFileSync(join(REPO_ROOT, 'themes/ionos/mail/IonosEMailTemplate.php'), 'utf8');
  const colors = [...mail.matchAll(new RegExp(hex, 'g'))].map((m) => m[0].toLowerCase()).sort();
  assert.deepEqual(colors, ['#0a0a0a', '#c8c8c8', '#fefefe', '#ffffff']);
  const theme = readFileSync(join(REPO_ROOT, 'themes/ionos/lib/IonosTheme.php'), 'utf8');
  assert.match(theme, /BRAND VALUES ARE IN ONE PLACE/);
  for (const line of theme.split('\n').filter((l) => hex.test(l))) assert.match(line, /PLACEHOLDER/, line);
});

/** Builds the real base `common` (with the real theme package) as flavor f and returns the artifact entries. */
function buildRealCommon(): Map<string, Uint8Array> {
  const root = makeFlavorsRoot({ 'flavors/f/flavor.yaml': 'extends: [common]\n' });
  cpSync(join(REPO_ROOT, 'bases/common'), join(root, 'bases/common'), { recursive: true });
  cpSync(join(REPO_ROOT, 'themes'), join(root, 'themes'), { recursive: true });
  const result = build({ flavorsRoot: root, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  return readZip(result.stdout.trim());
}

test('the instance settings for branding are in the base common and reach the artifact template', () => {
  const zip = buildRealCommon();
  assert.deepEqual(JSON.parse(text(zip, 'app-config.json')), {
    apps: {
      theming: {
        backgroundMime: 'backgroundColor', // a plain color, no background image
        background_color: '#2F5D9E',
        imprintUrl: 'https://example.invalid/imprint',
        name: 'IONOS Nextcloud Workspace',
        primary_color: '#2F5D9E',
        privacyUrl: 'https://example.invalid/privacy',
        productName: 'IONOS Nextcloud Workspace',
        slogan: '',
        url: 'https://example.invalid/',
      },
    },
  });
  assert.deepEqual(JSON.parse(text(zip, 'app-config-special.json')), [
    { app: 'theming', key: 'disable-user-theming', type: 'boolean', value: '1' },
  ]);
});

test('the placeholder URLs of the instance settings are all on example.invalid', () => {
  const settings = JSON.parse(text(buildRealCommon(), 'app-config.json')).apps.theming as Record<string, string>;
  for (const key of ['url', 'imprintUrl', 'privacyUrl']) assert.match(settings[key] as string, /^https:\/\/example\.invalid\//, key);
});

test('the primary color of the instance settings is the primary color of the theme class', () => {
  const settings = JSON.parse(text(buildRealCommon(), 'app-config.json')).apps.theming as Record<string, string>;
  const light = /public const LIGHT = \[\s*'primary' => '(#[0-9A-Fa-f]{6})'/.exec(readFileSync(join(REPO_ROOT, 'themes/ionos/lib/IonosTheme.php'), 'utf8'));
  assert.ok(light, 'IonosTheme::LIGHT starts with the primary color');
  assert.equal(settings.primary_color?.toLowerCase(), light[1]?.toLowerCase());
});

test('the client download links of the real base are placeholders and switch off the iOS smart banner', { skip: !hasPhp && 'php is not installed' }, () => {
  const config = JSON.parse(configAsNextcloudSeesIt(buildRealCommon(), 'config/13-clients.config.php')) as Record<string, string>;
  assert.deepEqual(config, {
    customclient_desktop: 'https://example.invalid/clients/desktop',
    customclient_ios: 'https://example.invalid/clients/ios',
    customclient_ios_appid: '',
    customclient_android: 'https://example.invalid/clients/android',
    customclient_fdroid: 'https://example.invalid/clients/fdroid',
  });
});

/** Every override file of the real theme package: path below assets/ and the decoded translations. */
function l10nOverrides(): { file: string; translations: Record<string, string> }[] {
  const assets = join(REPO_ROOT, 'themes/ionos/assets');
  return readdirSync(assets, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json') && e.parentPath.endsWith('/l10n'))
    .map((e) => {
      const path = join(e.parentPath, e.name);
      return { file: path.slice(assets.length + 1), translations: (JSON.parse(readFileSync(path, 'utf8')) as { translations: Record<string, string> }).translations };
    });
}

test('the translation overrides of the real theme are valid and say only the product name where they say Nextcloud', () => {
  const overrides = l10nOverrides();
  const files = overrides.map((o) => o.file).sort();
  // English (the source strings) and German for the strings of the server that can be reached by the theme folder
  for (const area of ['core', 'lib', 'apps/settings', 'apps/theming']) {
    for (const lang of ['en', 'de']) assert.ok(files.includes(`${area}/l10n/${lang}.json`), `${area}/l10n/${lang}.json`);
  }
  for (const { file, translations } of overrides) {
    const entries = Object.entries(translations);
    assert.ok(entries.length > 0, file);
    for (const [source, target] of entries) {
      assert.equal(typeof target, 'string', `${file}: ${source}`);
      assert.ok(target.includes('IONOS Nextcloud Workspace'), `${file}: the target names the product: ${target}`);
      assert.equal(target.replaceAll('IONOS Nextcloud Workspace', '').toLowerCase().includes('nextcloud'), false, `${file}: ${target}`);
    }
  }
});

test('the translation overrides are copied to the legacy theme folder and nowhere else', () => {
  const zip = buildRealCommon();
  for (const path of ['themes/ionos/core/l10n/en.json', 'themes/ionos/core/l10n/de.json', 'themes/ionos/apps/settings/l10n/en.json', 'themes/ionos/lib/l10n/de.json']) {
    assert.ok(zip.has(path), path);
  }
  assert.equal([...zip.keys()].some((p) => p.startsWith('lib/private/Ncw/') && p.endsWith('.json')), false);
});
