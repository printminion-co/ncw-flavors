<?php
// The download links of the desktop and mobile clients default to the Nextcloud ones. PLACEHOLDERS on example.invalid
// until the links of the IONOS clients are known. The empty app id switches off the iOS smart banner of the
// Nextcloud app (apple-itunes-app meta tag).
$CONFIG = [
  'customclient_desktop' => 'https://example.invalid/clients/desktop',
  'customclient_ios' => 'https://example.invalid/clients/ios',
  'customclient_ios_appid' => '',
  'customclient_android' => 'https://example.invalid/clients/android',
  'customclient_fdroid' => 'https://example.invalid/clients/fdroid',
];
