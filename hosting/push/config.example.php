<?php
// Скопіюй у config.php НА СЕРВЕРІ (його немає в репозиторії й CI його не перезаписує). Згенерувати значення: `php keygen.php`.
return [
    'subject'           => 'mailto:you@example.com',            // контакт для push-сервісів (VAPID)
    'vapid_public'      => '',                                   // з keygen.php
    'vapid_private_pem' => '',                                   // з keygen.php (PEM, багаторядковий)
    'enc_key'           => '',                                   // з keygen.php: ключ шифрування паролів застосунку (base64, 32 байти)
    'cron_key'          => '',                                   // довільний довгий рядок для cron через wget (або запускай через php-cli)
    'origins'           => ['https://skybee.online', 'https://vysocavnu.github.io'],
    // 'data_dir'       => '/home/USER/skybee-push-data',        // бажано ПОЗА текою сайту; без цього — push/data (закрита в .htaccess)
];
