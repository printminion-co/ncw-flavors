<?php
// The legacy theme folder: the server loads themes/ionos/ (translation overrides, template overrides, CSS) and the
// theming app shows its admin settings page as "already using a custom theme" (the lock on admin theming).
// The name is the one of the theme package, whose assets the build copies to themes/ionos/.
$CONFIG = [
  'theme' => 'ionos',
];
