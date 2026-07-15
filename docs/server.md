# Серверный маршрут Routeva

Routeva не требует Happ, Amnezia, Xray или другого VPN-клиента на компьютере.
Chrome/Brave подключается к обычному HTTPS-прокси, а протоколы подписки
запускаются на сервере пользователя.

```text
Chrome/Brave
  └─ PAC: выбранные домены или весь интернет
      └─ HTTPS proxy · ton4.pro:18443
          └─ stunnel · 127.0.0.1:18444
              └─ tinyproxy + BasicAuth
                  └─ Routeva Mihomo · 127.0.0.1:18447
                      └─ выбранный VLESS / Hysteria2 / Shadowsocks / другой узел

Расширение
  └─ HTTPS API · ton4.pro:18445
      └─ stunnel · 127.0.0.1:18446
          └─ Routeva Gateway
              └─ Mihomo controller · 127.0.0.1:18448
```

## Изоляция

- существующий системный `mihomo.service` и его конфигурация не изменяются;
- Routeva использует отдельный `routeva-mihomo.service` и отдельный каталог;
- порты `18446`, `18447` и `18448` слушают только loopback;
- наружу открыты только TLS-порты прокси `18443` и API `18445`;
- API использует Basic Auth с данными основного прокси;
- внутренний Mihomo controller защищён отдельным случайным секретом;
- подписки, токены и сгенерированные provider-файлы имеют права `0600` и не входят в Git.

## Компоненты

- `/opt/routeva-gateway/routeva_gateway.py` — API импорта, обновления и выбора узла;
- `/etc/routeva-gateway/gateway.env` — API-учётные данные и внутренний секрет;
- `/etc/routeva-gateway/state.json` — персональные ссылки подписок;
- `/etc/routeva-gateway/mihomo/config.yaml` — генерируемая конфигурация туннеля;
- `routeva-gateway.service` — управляющий API;
- `routeva-mihomo.service` — отдельный протокольный движок.

## Диагностика

```bash
systemctl status routeva-gateway routeva-mihomo stunnel4 tinyproxy
ss -lntp | grep -E ':(18443|18445|18446|18447|18448)'
journalctl -u routeva-gateway -u routeva-mihomo --since '-15 min'
```

Не добавляйте в Git SSH-пароль, логин/пароль прокси, `gateway.env`,
`state.json`, provider-файлы или персональные ссылки подписок.
