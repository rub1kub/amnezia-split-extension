# Серверный маршрут

Текущая схема не меняет контейнеры Amnezia и не занимает их порты.

```text
Chrome/Brave
  └─ HTTPS proxy (TLS 1.2+) — ton4.pro:18443
       └─ stunnel — 127.0.0.1:18444
            └─ tinyproxy + BasicAuth
                 └─ интернет с IP VPN-сервера
```

## Развёрнутые компоненты

- `stunnel4` принимает только TLS 1.2+ на TCP 18443;
- сертификат Let’s Encrypt берётся из `/etc/letsencrypt/live/ton4.pro/`;
- deploy-hook перезагружает stunnel после обновления сертификата;
- `tinyproxy` слушает только `127.0.0.1:18444` и недоступен напрямую извне;
- отдельные данные BasicAuth не совпадают с root-доступом к серверу;
- файл восстановления реквизитов доступен только root на самом сервере.

## Диагностика

```bash
systemctl status stunnel4 tinyproxy
ss -lntp | grep -E ':(18443|18444)'
curl --proxy https://ton4.pro:18443 --proxy-user 'USER:PASSWORD' https://api.ipify.org
```

Не добавляйте пароль прокси, SSH-пароль, приватные ключи или содержимое `/root/amnezia-browser-proxy-credentials` в Git.
