<?php
// Одноразово, у консолі: `php keygen.php` — друкує значення для config.php. Через веб не працює.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$k = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
openssl_pkey_export($k, $pem);
$d = openssl_pkey_get_details($k)['ec'];
$pub = rtrim(strtr(base64_encode("\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT)), '+/', '-_'), '=');
echo "'vapid_public'      => '$pub',\n";
echo "'vapid_private_pem' => <<<PEM\n$pem" . "PEM,\n";
echo "'enc_key'           => '" . base64_encode(random_bytes(32)) . "',\n";
echo "'cron_key'          => '" . bin2hex(random_bytes(16)) . "',\n";
