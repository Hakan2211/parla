# Parla — Hardware Device Concept

## The product

A small, friendly speaker that sits on a desk or nightstand. Press (or say the wake word) and you're talking to your Parla persona — no phone, no app open, no screen. The same account, personas, and memory as the web app.

Why it's credible: **the device is deliberately dumb.** All intelligence (VAD, turn-taking, STT, LLM, TTS, memory) already lives on the server (see [architecture](01-architecture.md)). The device only does: capture mic → send Opus frames → play received Opus frames → show a light. That is firmware a solo developer can actually ship.

## Development path

### Stage 1 — Dev-kit prototype (after web MVP, ~2–4 weekends)
- **ESP32-S3-BOX-3** (~$50, has mic array, speaker, small screen, enclosure) or Seeed **ReSpeaker** kit
- Firmware: ESP-IDF + esp-audio; **Opus over WebSocket (TLS)** to the voice worker, push-to-talk button first
- Auth: device pairing code shown at parla.app → short-lived device token
- Reuse the exact client protocol from the web app (`transcript/assistant/session` events drive the LED ring)
- Reference points: ESP32 voice satellites are a proven pattern (Home Assistant Voice PE, Willow) — this is charted territory

### Stage 2 — Wake word + polish
- **openWakeWord server-side first** (device streams only after button/VAD, server detects "Hey <persona>") — zero firmware ML
- Later: on-device wake word (ESP-SR / microWakeWord) for privacy + battery
- Wi-Fi provisioning via BLE from the phone (standard ESP32 flow)
- Multi-user households: voice-selected persona ("talk to Coach")

### Stage 3 — Real product (only if Stages 1–2 earn it)
- Custom PCB around ESP32-S3: 2-mic array, 3–5W speaker, LED ring, USB-C, optional battery
- Injection-molded or CNC enclosure; CE/FCC certification budget (~$10–20k realistic)
- Small-batch manufacturing (100–500 units) via a PCBA house; sell as "Parla for your desk" to existing subscribers first

## Latency note

Device → Hetzner over home Wi-Fi adds ~30–80ms vs the browser path — the <1s budget still holds. Opus at 24–48 kbps keeps bandwidth trivial.

## Business shape

- Device is a **retention anchor and differentiator**, not the margin driver: sell near cost (~$59–89), it locks in the subscription
- Server-side capacity math is unchanged — a device session is just another pipeline session
- Privacy story matters: mic hard-off switch, LED always on when streaming, memory page shows/deletes everything

## Do-not-do list

- No on-device LLM/STT/TTS — kills the thin-client advantage and the BOM
- No screen-centric product — it competes with phones and loses; voice+light only
- No custom hardware before the web product has paying, retained users
