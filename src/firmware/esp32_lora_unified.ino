#include <Arduino.h>
#include <RadioLib.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <Preferences.h>
#include <mbedtls/aes.h>
#include <esp_system.h>

BLEAdvertising *g_advertising = nullptr;
BLECharacteristic *g_txDyn = nullptr;
BLECharacteristic *g_rxDyn = nullptr;
BLECharacteristic *g_txBase = nullptr;
BLECharacteristic *g_rxBase = nullptr;
Preferences g_prefs;

struct LoraConfig
{
    uint32_t magic;
    uint8_t deviceType;
    uint8_t csPin;
    uint8_t resetPin;
    uint8_t busyPin;
    uint8_t dioPin;
    float frequency;
    float bandwidth;
    uint8_t spreadingFactor;
    uint8_t codingRate;
    uint8_t syncWord;
    uint16_t preambleLength;
    float tcxoVoltage;
    bool useDio2AsRfSwitch;
    bool btEnabled;
    uint8_t pwr;
    uint8_t sclkPin;
    uint8_t misoPin;
    uint8_t mosiPin;
    uint8_t nssPin;
    uint8_t rstPin;
    uint8_t dio0Pin;
    uint8_t dio1Pin;
};

struct MeshPeer
{
    uint16_t id;
    uint32_t lastSeenMs;
};

struct SensorDef
{
    uint8_t pin;
    bool analog;
};

struct WeatherPersistConfig
{
    uint32_t magic;
    uint8_t weatherMode;
    uint32_t weatherIntervalMs;
    uint8_t sensorCount;
    SensorDef sensors[6];
};

static const uint32_t CFG_MAGIC = 0x4C4F5241;
static const uint32_t WX_MAGIC = 0x57585452;

static const uint8_t MAX_PEERS = 16;
static const uint8_t MAX_SENSORS = 6;

LoraConfig g_cfg{};
SX1262 *g_radio = nullptr;
MeshPeer g_peers[MAX_PEERS]{};
SensorDef g_sensors[MAX_SENSORS]{};

String g_bleRxDyn;
String g_bleRxBase;

bool g_configSaved = false;
bool g_radioReady = false;
bool g_setupMode = false;
bool g_setupSaveRequested = false;
bool g_btActive = false;
bool g_meshRunning = false;
bool g_meshEncryptionEnabled = false;
bool g_weatherModeEnabled = false;

uint16_t g_nodeId = 0;
uint8_t g_peerCount = 0;
uint8_t g_sensorCount = 0;
uint8_t g_meshKey[16] = {0x10, 0x32, 0x54, 0x76, 0x98, 0xBA, 0xDC, 0xFE, 0x22, 0x44, 0x66, 0x88, 0xAA, 0xCC, 0xEE, 0x00};
uint32_t g_meshTxCounter = 1;
uint32_t g_weatherIntervalMs = 5000;
uint32_t g_lastWeatherTxMs = 0;

static uint16_t crc16_ccitt(const uint8_t *data, size_t len);

static String toHexByte(uint8_t b)
{
    const char *hex = "0123456789ABCDEF";
    String s;
    s.reserve(2);
    s += hex[(b >> 4) & 0x0F];
    s += hex[b & 0x0F];
    return s;
}

static String jsonEscape(const String &in)
{
    String out;
    out.reserve(in.length() * 2 + 8);
    for (size_t i = 0; i < in.length(); ++i)
    {
        uint8_t c = (uint8_t)in[i];
        if (c == '"')
            out += "\\\"";
        else if (c == '\\')
            out += "\\\\";
        else if (c == '\n')
            out += "\\n";
        else if (c == '\r')
            out += "\\r";
        else if (c == '\t')
            out += "\\t";
        else if (c >= 32 && c <= 126)
            out += (char)c;
        else
        {
            out += "\\u00";
            out += toHexByte(c);
        }
    }
    return out;
}

static bool parseHexKey16(const String &inHex, uint8_t out[16])
{
    String s = inHex;
    s.trim();
    if (s.startsWith("0x") || s.startsWith("0X"))
        s = s.substring(2);
    if (s.length() != 32)
        return false;

    for (uint8_t i = 0; i < 16; i++)
    {
        char hi = s.charAt(i * 2);
        char lo = s.charAt(i * 2 + 1);

        auto nibble = [](char c) -> int
        {
            if (c >= '0' && c <= '9')
                return c - '0';
            if (c >= 'a' && c <= 'f')
                return 10 + (c - 'a');
            if (c >= 'A' && c <= 'F')
                return 10 + (c - 'A');
            return -1;
        };

        int h = nibble(hi);
        int l = nibble(lo);
        if (h < 0 || l < 0)
            return false;
        out[i] = (uint8_t)((h << 4) | l);
    }
    return true;
}

static String meshKeyHex()
{
    String s;
    s.reserve(32);
    for (uint8_t i = 0; i < 16; i++)
        s += toHexByte(g_meshKey[i]);
    return s;
}

static String currentProfileKey()
{
    return g_cfg.deviceType == 0 ? "heltec_v3" : "megamesh";
}

static void sendMsg(const String &line)
{
    Serial.println(line);
    if (!g_btActive || (!g_txDyn && !g_txBase))
        return;

    const char *raw = line.c_str();
    size_t len = line.length();
    const size_t chunk = 180;

    for (size_t off = 0; off < len; off += chunk)
    {
        size_t chunkLen = len - off;
        if (chunkLen > chunk)
            chunkLen = chunk;
        bool hasMore = (off + chunkLen) < len;

        if (g_txDyn)
        {
            g_txDyn->setValue((uint8_t *)(raw + off), chunkLen);
            g_txDyn->notify();
        }
        if (g_txBase)
        {
            g_txBase->setValue((uint8_t *)(raw + off), chunkLen);
            g_txBase->notify();
        }
        if (hasMore)
            delay(5);
    }
}

static void setDefaultsHeltec()
{
    g_cfg.deviceType = 0;
    g_cfg.csPin = 8;
    g_cfg.resetPin = 12;
    g_cfg.busyPin = 13;
    g_cfg.dioPin = 14;
    g_cfg.frequency = 868.0;
    g_cfg.bandwidth = 125.0;
    g_cfg.spreadingFactor = 7;
    g_cfg.codingRate = 5;
    g_cfg.syncWord = 0x12;
    g_cfg.preambleLength = 8;
    g_cfg.tcxoVoltage = 1.8;
    g_cfg.useDio2AsRfSwitch = false;
    g_cfg.btEnabled = true;
    g_cfg.pwr = 14;
    g_cfg.sclkPin = 9;
    g_cfg.misoPin = 11;
    g_cfg.mosiPin = 10;
    g_cfg.nssPin = 8;
    g_cfg.rstPin = 12;
    g_cfg.dio0Pin = 13;
    g_cfg.dio1Pin = 14;
}

static void setDefaultsWroom()
{
    g_cfg.deviceType = 1;
    g_cfg.csPin = 5;
    g_cfg.resetPin = 14;
    g_cfg.busyPin = 26;
    g_cfg.dioPin = 35;
    g_cfg.frequency = 868.0;
    g_cfg.bandwidth = 125.0;
    g_cfg.spreadingFactor = 9;
    g_cfg.codingRate = 7;
    g_cfg.syncWord = 0x12;
    g_cfg.preambleLength = 22;
    g_cfg.tcxoVoltage = 1.6;
    g_cfg.useDio2AsRfSwitch = false;
    g_cfg.btEnabled = true;
    g_cfg.pwr = 17;
    g_cfg.sclkPin = 18;
    g_cfg.misoPin = 19;
    g_cfg.mosiPin = 23;
    g_cfg.nssPin = 5;
    g_cfg.rstPin = 14;
    g_cfg.dio0Pin = 26;
    g_cfg.dio1Pin = 35;
}

static void enforceHeltecPins()
{
    g_cfg.csPin = 8;
    g_cfg.resetPin = 12;
    g_cfg.busyPin = 13;
    g_cfg.dioPin = 14;
    g_cfg.sclkPin = 9;
    g_cfg.misoPin = 11;
    g_cfg.mosiPin = 10;
    g_cfg.nssPin = 8;
    g_cfg.rstPin = 12;
    g_cfg.dio0Pin = 13;
    g_cfg.dio1Pin = 14;
    if (g_cfg.tcxoVoltage <= 0.01f)
        g_cfg.tcxoVoltage = 1.8f;
}

static bool putBytesIfChanged(const char *ns, const char *key, const void *data, size_t len)
{
    bool same = false;
    g_prefs.begin(ns, true);
    size_t oldLen = g_prefs.getBytesLength(key);
    if (oldLen == len)
    {
        uint8_t *buf = (uint8_t *)malloc(len);
        if (buf)
        {
            g_prefs.getBytes(key, buf, len);
            same = memcmp(buf, data, len) == 0;
            free(buf);
        }
    }
    g_prefs.end();

    if (same)
        return false;

    g_prefs.begin(ns, false);
    g_prefs.putBytes(key, data, len);
    g_prefs.end();
    return true;
}

static void saveWeatherConfig()
{
    WeatherPersistConfig w{};
    w.magic = WX_MAGIC;
    w.weatherMode = g_weatherModeEnabled ? 1 : 0;
    w.weatherIntervalMs = g_weatherIntervalMs;
    w.sensorCount = g_sensorCount;
    for (uint8_t i = 0; i < MAX_SENSORS; i++)
    {
        if (i < g_sensorCount)
            w.sensors[i] = g_sensors[i];
        else
        {
            w.sensors[i].pin = 0;
            w.sensors[i].analog = false;
        }
    }
    putBytesIfChanged("lora", "wxcfg", &w, sizeof(w));
}

static void loadWeatherConfig()
{
    g_sensorCount = 0;

    g_prefs.begin("lora", true);
    size_t len = g_prefs.getBytesLength("wxcfg");
    if (len == sizeof(WeatherPersistConfig))
    {
        WeatherPersistConfig w{};
        g_prefs.getBytes("wxcfg", &w, sizeof(w));
        g_prefs.end();

        if (w.magic == WX_MAGIC)
        {
            g_weatherModeEnabled = w.weatherMode != 0;
            g_weatherIntervalMs = w.weatherIntervalMs < 500 ? 500 : w.weatherIntervalMs;
            g_sensorCount = w.sensorCount > MAX_SENSORS ? MAX_SENSORS : w.sensorCount;
            for (uint8_t i = 0; i < g_sensorCount; i++)
            {
                g_sensors[i] = w.sensors[i];
                pinMode(g_sensors[i].pin, g_sensors[i].analog ? INPUT : INPUT_PULLUP);
            }
        }
        return;
    }
    g_prefs.end();
}

static void saveConfig()
{
    g_cfg.magic = CFG_MAGIC;
    putBytesIfChanged("lora", "cfg", &g_cfg, sizeof(g_cfg));
    saveWeatherConfig();
    g_configSaved = true;
    sendMsg("{\"evt\":\"cfg_saved\"}");
}

static bool loadConfig()
{
    struct LegacyLoraConfig
    {
        uint32_t magic;
        uint8_t deviceType;
        uint8_t csPin;
        uint8_t resetPin;
        uint8_t busyPin;
        uint8_t dioPin;
        float frequency;
        float bandwidth;
        uint8_t spreadingFactor;
        uint8_t codingRate;
        uint8_t syncWord;
        uint16_t preambleLength;
        float tcxoVoltage;
        bool useDio2AsRfSwitch;
        bool btEnabled;
    };

    g_prefs.begin("lora", true);
    size_t len = g_prefs.getBytesLength("cfg");

    if (len == sizeof(g_cfg))
    {
        g_prefs.getBytes("cfg", &g_cfg, sizeof(g_cfg));
        g_prefs.end();
        if (g_cfg.magic == CFG_MAGIC)
        {
            if (g_cfg.deviceType == 0)
                enforceHeltecPins();
            loadWeatherConfig();
            g_configSaved = true;
            return true;
        }
    }

    if (len == sizeof(LegacyLoraConfig))
    {
        LegacyLoraConfig oldCfg{};
        g_prefs.getBytes("cfg", &oldCfg, sizeof(oldCfg));
        g_prefs.end();

        if (oldCfg.magic == CFG_MAGIC)
        {
            g_cfg.magic = oldCfg.magic;
            g_cfg.deviceType = oldCfg.deviceType;
            g_cfg.csPin = oldCfg.csPin;
            g_cfg.resetPin = oldCfg.resetPin;
            g_cfg.busyPin = oldCfg.busyPin;
            g_cfg.dioPin = oldCfg.dioPin;
            g_cfg.frequency = oldCfg.frequency;
            g_cfg.bandwidth = oldCfg.bandwidth;
            g_cfg.spreadingFactor = oldCfg.spreadingFactor;
            g_cfg.codingRate = oldCfg.codingRate;
            g_cfg.syncWord = oldCfg.syncWord;
            g_cfg.preambleLength = oldCfg.preambleLength;
            g_cfg.tcxoVoltage = oldCfg.tcxoVoltage;
            g_cfg.useDio2AsRfSwitch = oldCfg.useDio2AsRfSwitch;
            g_cfg.btEnabled = oldCfg.btEnabled;

            if (g_cfg.deviceType == 0)
            {
                g_cfg.pwr = 14;
                enforceHeltecPins();
            }
            else
            {
                g_cfg.pwr = 17;
                g_cfg.sclkPin = 18;
                g_cfg.misoPin = 19;
                g_cfg.mosiPin = 23;
                g_cfg.nssPin = g_cfg.csPin;
                g_cfg.rstPin = g_cfg.resetPin;
                g_cfg.dio0Pin = g_cfg.busyPin;
                g_cfg.dio1Pin = g_cfg.dioPin;
            }

            loadWeatherConfig();
            g_configSaved = true;
            return true;
        }
    }

    g_prefs.end();
    return false;
}

static bool encryptCtr(const uint8_t *plain, uint8_t *cipher, size_t len, const uint8_t nonce[8], uint32_t counter)
{
    if (!g_meshEncryptionEnabled)
    {
        memcpy(cipher, plain, len);
        return true;
    }

    mbedtls_aes_context ctx;
    mbedtls_aes_init(&ctx);
    if (mbedtls_aes_setkey_enc(&ctx, g_meshKey, 128) != 0)
    {
        mbedtls_aes_free(&ctx);
        return false;
    }

    uint8_t nonceCounter[16] = {0};
    memcpy(nonceCounter, nonce, 8);
    nonceCounter[8] = (uint8_t)((counter >> 24) & 0xFF);
    nonceCounter[9] = (uint8_t)((counter >> 16) & 0xFF);
    nonceCounter[10] = (uint8_t)((counter >> 8) & 0xFF);
    nonceCounter[11] = (uint8_t)(counter & 0xFF);

    uint8_t streamBlock[16] = {0};
    size_t ncOff = 0;
    int rc = mbedtls_aes_crypt_ctr(&ctx, len, &ncOff, nonceCounter, streamBlock, plain, cipher);
    mbedtls_aes_free(&ctx);
    return rc == 0;
}

static bool decryptCtr(const uint8_t *cipher, uint8_t *plain, size_t len, const uint8_t nonce[8], uint32_t counter)
{
    return encryptCtr(cipher, plain, len, nonce, counter);
}

static void updatePeer(uint16_t id)
{
    if (!id)
        return;

    for (uint8_t i = 0; i < g_peerCount; i++)
    {
        if (g_peers[i].id == id)
        {
            g_peers[i].lastSeenMs = millis();
            return;
        }
    }

    if (g_peerCount < MAX_PEERS)
    {
        g_peers[g_peerCount].id = id;
        g_peers[g_peerCount].lastSeenMs = millis();
        g_peerCount++;
    }
}

static bool sendMeshPacket(uint8_t type, uint16_t dst, const uint8_t *payload, uint8_t payloadLen)
{
    if (!g_radioReady || !g_radio)
        return false;
    if (payloadLen > 120)
        return false;

    uint8_t frame[160] = {0};
    uint8_t enc[120] = {0};
    uint8_t nonce[8] = {0};

    uint32_t r0 = esp_random();
    uint32_t r1 = esp_random();
    memcpy(nonce, &r0, 4);
    memcpy(nonce + 4, &r1, 4);

    bool plainType = (type == 0x01 || type == 0x02 || type == 0x30 || type == 0x31);
    if (plainType)
        memcpy(enc, payload, payloadLen);
    else if (!encryptCtr(payload, enc, payloadLen, nonce, g_meshTxCounter))
        return false;

    size_t idx = 0;
    frame[idx++] = 0x4D;
    frame[idx++] = 0x58;
    frame[idx++] = 0x01;
    frame[idx++] = type;
    frame[idx++] = (uint8_t)((g_nodeId >> 8) & 0xFF);
    frame[idx++] = (uint8_t)(g_nodeId & 0xFF);
    frame[idx++] = (uint8_t)((dst >> 8) & 0xFF);
    frame[idx++] = (uint8_t)(dst & 0xFF);
    frame[idx++] = (uint8_t)((g_meshTxCounter >> 24) & 0xFF);
    frame[idx++] = (uint8_t)((g_meshTxCounter >> 16) & 0xFF);
    frame[idx++] = (uint8_t)((g_meshTxCounter >> 8) & 0xFF);
    frame[idx++] = (uint8_t)(g_meshTxCounter & 0xFF);
    memcpy(frame + idx, nonce, 8);
    idx += 8;
    frame[idx++] = payloadLen;
    memcpy(frame + idx, enc, payloadLen);
    idx += payloadLen;

    uint16_t crc = crc16_ccitt(frame, idx);
    frame[idx++] = (uint8_t)((crc >> 8) & 0xFF);
    frame[idx++] = (uint8_t)(crc & 0xFF);

    g_meshTxCounter++;
    int16_t tx = g_radio->transmit(frame, idx);
    return tx == RADIOLIB_ERR_NONE;
}

static void sendPeerList()
{
    String j = "{\"evt\":\"peers\",\"items\":[";
    for (uint8_t i = 0; i < g_peerCount; i++)
    {
        if (i)
            j += ",";
        j += "{\"id\":" + String(g_peers[i].id) + ",\"ageMs\":" + String(millis() - g_peers[i].lastSeenMs) + "}";
    }
    j += "]}";
    sendMsg(j);
}

static bool addSensor(uint8_t pin, bool analogMode)
{
    for (uint8_t i = 0; i < g_sensorCount; i++)
    {
        if (g_sensors[i].pin == pin)
        {
            g_sensors[i].analog = analogMode;
            return true;
        }
    }

    if (g_sensorCount >= MAX_SENSORS)
        return false;

    g_sensors[g_sensorCount].pin = pin;
    g_sensors[g_sensorCount].analog = analogMode;
    pinMode(pin, analogMode ? INPUT : INPUT_PULLUP);
    g_sensorCount++;
    return true;
}

static void sendWeatherPacket()
{
    if (!g_meshRunning || !g_radioReady)
        return;

    String payload = String("WX:") + String(g_nodeId);
    for (uint8_t i = 0; i < g_sensorCount; i++)
    {
        int value = g_sensors[i].analog ? analogRead(g_sensors[i].pin) : digitalRead(g_sensors[i].pin);
        payload += ";" + String(g_sensors[i].pin) + ":" + String(value);
    }

    if (sendMeshPacket(0x10, 0xFFFF, (const uint8_t *)payload.c_str(), (uint8_t)payload.length()))
        sendMsg(String("{\"evt\":\"weather_tx\",\"sensors\":") + g_sensorCount + "}");
}

static bool sendWebsiteMessage(uint16_t dst, const String &payload)
{
    if (!g_meshRunning || !g_radioReady)
        return false;

    String p = payload;
    p.trim();
    if (!p.length() || p.length() > 120)
        return false;

    return sendMeshPacket(0x20, dst, (const uint8_t *)p.c_str(), (uint8_t)p.length());
}

static bool initRadioRobust(bool emit)
{
    int16_t lastState = -999;

    auto beginWith = [&](float tcxo, uint8_t pwr) -> int16_t
    {
        if (g_radio)
        {
            delete g_radio;
            g_radio = nullptr;
        }
        Module *mod = new Module(g_cfg.nssPin, g_cfg.dio1Pin, g_cfg.rstPin, g_cfg.dio0Pin);
        g_radio = new SX1262(mod);
        return g_radio->begin(g_cfg.frequency, g_cfg.bandwidth, g_cfg.spreadingFactor, g_cfg.codingRate, g_cfg.syncWord, pwr, g_cfg.preambleLength, tcxo, false);
    };

    auto tryProfile = [&](bool enforcePins) -> bool
    {
        if (enforcePins && g_cfg.deviceType == 0)
            enforceHeltecPins();

        const float tcxoTry[] = {g_cfg.tcxoVoltage, 1.8f, 1.6f, 0.0f};
        const uint8_t pwrTry[] = {g_cfg.pwr, (uint8_t)14, (uint8_t)10};

        for (uint8_t p = 0; p < 3; p++)
        {
            uint8_t outPwr = pwrTry[p];

            for (uint8_t i = 0; i < 4; i++)
            {
                float tcxo = tcxoTry[i];
                int16_t state = beginWith(tcxo, outPwr);
                lastState = state;
                if (state == RADIOLIB_ERR_NONE)
                {
                    g_cfg.tcxoVoltage = tcxo;
                    g_cfg.pwr = outPwr;
                    if (emit)
                        sendMsg(String("{\"evt\":\"tcxo_auto\",\"v\":") + String(g_cfg.tcxoVoltage, 1) + "}");
                    return true;
                }
            }
        }

        return false;
    };

    bool ok = tryProfile(false);
    if (!ok && g_cfg.deviceType == 0)
        ok = tryProfile(true);

    g_radioReady = ok;
    if (ok)
    {
        if (emit)
            sendMsg("{\"evt\":\"radio_ready\"}");
        return true;
    }

    if (emit)
        sendMsg(String("{\"evt\":\"radio_err\",\"code\":") + lastState + "}");
    return false;
}

static bool ensureMeshRunning(bool emit)
{
    if (!g_radioReady)
    {
        if (!initRadioRobust(emit))
        {
            if (emit)
                sendMsg("{\"evt\":\"radio_not_ready\"}");
            return false;
        }
    }

    uint64_t mac = ESP.getEfuseMac();
    g_nodeId = (uint16_t)(mac & 0xFFFF);
    g_meshRunning = true;
    if (emit)
        sendMsg(String("{\"evt\":\"mesh_started\",\"nodeId\":") + g_nodeId + "}");
    return true;
}

static void sendDiscoveryResponse(uint16_t dst)
{
    String p = String("NODE:") + String(g_nodeId);
    sendMeshPacket(0x02, dst, (const uint8_t *)p.c_str(), (uint8_t)p.length());
}

static void broadcastDiscovery()
{
    String p = String("DISCOVER:") + String(g_nodeId);
    if (sendMeshPacket(0x01, 0xFFFF, (const uint8_t *)p.c_str(), (uint8_t)p.length()))
        sendMsg("{\"evt\":\"scan_started\"}");
    else
        sendMsg("{\"evt\":\"radio_err\",\"code\":-999}");
}

static void handleMeshFrame(uint8_t *buf, size_t len)
{
    if (len < 22)
        return;
    if (buf[0] != 0x4D || buf[1] != 0x58)
        return;

    uint16_t fcrc = ((uint16_t)buf[len - 2] << 8) | buf[len - 1];
    uint16_t ccrc = crc16_ccitt(buf, len - 2);
    if (fcrc != ccrc)
        return;

    uint8_t type = buf[3];
    uint16_t src = ((uint16_t)buf[4] << 8) | buf[5];
    uint16_t dst = ((uint16_t)buf[6] << 8) | buf[7];
    uint32_t ctr = ((uint32_t)buf[8] << 24) | ((uint32_t)buf[9] << 16) | ((uint32_t)buf[10] << 8) | (uint32_t)buf[11];
    uint8_t nonce[8] = {0};
    memcpy(nonce, buf + 12, 8);
    uint8_t payloadLen = buf[20];

    if (21 + payloadLen + 2 != len)
        return;
    if (!(dst == 0xFFFF || dst == g_nodeId))
        return;

    uint8_t plain[120] = {0};
    bool plainType = (type == 0x01 || type == 0x02 || type == 0x30 || type == 0x31);
    if (plainType)
        memcpy(plain, buf + 21, payloadLen);
    else if (!decryptCtr(buf + 21, plain, payloadLen, nonce, ctr))
        return;

    updatePeer(src);

    String payload;
    payload.reserve(payloadLen);
    for (uint8_t i = 0; i < payloadLen; i++)
        payload += (char)plain[i];
    String payloadJson = jsonEscape(payload);

    if (type == 0x01)
    {
        sendDiscoveryResponse(src);
        sendMsg(String("{\"evt\":\"peer_found\",\"id\":") + src + "}");
        return;
    }
    if (type == 0x02)
    {
        sendMsg(String("{\"evt\":\"peer_found\",\"id\":") + src + "}");
        return;
    }
    if (type == 0x10)
    {
        sendMsg(String("{\"evt\":\"weather_rx\",\"from\":") + src + ",\"data\":\"" + payloadJson + "\"}");
        return;
    }
    if (type == 0x20)
    {
        sendMsg(String("{\"evt\":\"msg_rx\",\"from\":") + src + ",\"data\":\"" + payloadJson + "\"}");
        return;
    }
    if (type == 0x30)
    {
        if (payload.startsWith("KEY:"))
        {
            String keyHex = payload.substring(4);
            uint8_t parsed[16];
            if (parseHexKey16(keyHex, parsed))
            {
                memcpy(g_meshKey, parsed, 16);
                sendMsg(String("{\"evt\":\"mesh_key_rx\",\"from\":") + src + ",\"v\":\"" + meshKeyHex() + "\"}");
                String ack = "KEY_OK";
                sendMeshPacket(0x31, src, (const uint8_t *)ack.c_str(), (uint8_t)ack.length());
                return;
            }
        }
        sendMsg(String("{\"evt\":\"mesh_key_rx_err\",\"from\":") + src + "}");
        return;
    }
    if (type == 0x31)
    {
        sendMsg(String("{\"evt\":\"mesh_key_ack\",\"from\":") + src + "}");
        return;
    }

    sendMsg(String("{\"evt\":\"mesh_rx\",\"from\":") + src + ",\"t\":" + type + ",\"data\":\"" + payloadJson + "\"}");
}

static void sendSetupInfo()
{
    String syncHex = String(g_cfg.syncWord, HEX);
    syncHex.toUpperCase();
    if (syncHex.length() < 2)
        syncHex = "0" + syncHex;

    String j = "{\"evt\":\"setup_info\"";
    j.reserve(1200);
    j += ",\"device\":\"" + currentProfileKey() + "\"";
    j += ",\"first_setup\":" + String(g_configSaved ? "false" : "true");
    j += ",\"fields\":[";
    j += "{\"k\":\"device\",\"v\":\"" + currentProfileKey() + "\",\"opts\":\"heltec_v3|megamesh\"}";
    j += ",{\"k\":\"freq\",\"v\":" + String(g_cfg.frequency, 1) + ",\"unit\":\"MHz\",\"opts\":\"433.0|868.0|869.5|915.0\",\"min\":137.0,\"max\":1020.0}";
    j += ",{\"k\":\"bw\",\"v\":" + String(g_cfg.bandwidth, 1) + ",\"unit\":\"kHz\",\"opts\":\"7.8|10.4|15.6|20.8|31.25|41.7|62.5|125|250|500\"}";
    j += ",{\"k\":\"sf\",\"v\":" + String(g_cfg.spreadingFactor) + ",\"opts\":\"6|7|8|9|10|11|12\",\"min\":6,\"max\":12}";
    j += ",{\"k\":\"cr\",\"v\":" + String(g_cfg.codingRate) + ",\"opts\":\"5|6|7|8\"}";
    j += ",{\"k\":\"pwr\",\"v\":" + String(g_cfg.pwr) + ",\"unit\":\"dBm\",\"opts\":\"2|10|14|17|20|22\",\"min\":2,\"max\":22}";
    j += ",{\"k\":\"sw\",\"v\":\"0x" + syncHex + "\",\"type\":\"hex\"}";
    j += ",{\"k\":\"preamble\",\"v\":" + String(g_cfg.preambleLength) + ",\"opts\":\"8|12|16|22|32\",\"min\":6,\"max\":65535}";
    j += ",{\"k\":\"tcxo\",\"v\":" + String(g_cfg.tcxoVoltage, 1) + ",\"unit\":\"V\",\"opts\":\"0.0|1.6|1.8|2.4|3.3\"}";
    j += ",{\"k\":\"dio2\",\"v\":" + String(g_cfg.useDio2AsRfSwitch ? 1 : 0) + ",\"opts\":\"0|1\"}";
    j += ",{\"k\":\"sclk\",\"v\":" + String(g_cfg.sclkPin) + ",\"type\":\"pin\"}";
    j += ",{\"k\":\"miso\",\"v\":" + String(g_cfg.misoPin) + ",\"type\":\"pin\"}";
    j += ",{\"k\":\"mosi\",\"v\":" + String(g_cfg.mosiPin) + ",\"type\":\"pin\"}";
    j += ",{\"k\":\"nss\",\"v\":" + String(g_cfg.nssPin) + ",\"type\":\"pin\"}";
    j += ",{\"k\":\"rst\",\"v\":" + String(g_cfg.rstPin) + ",\"type\":\"pin\"}";
    j += ",{\"k\":\"dio0\",\"v\":" + String(g_cfg.dio0Pin) + ",\"type\":\"pin\"}";
    j += ",{\"k\":\"dio1\",\"v\":" + String(g_cfg.dio1Pin) + ",\"type\":\"pin\"}";
    j += ",{\"k\":\"weather\",\"v\":" + String(g_weatherModeEnabled ? 1 : 0) + ",\"opts\":\"0|1\"}";
    j += ",{\"k\":\"weather_interval\",\"v\":" + String(g_weatherIntervalMs) + ",\"unit\":\"ms\",\"opts\":\"5000|10000|30000|60000|300000\",\"min\":500,\"max\":600000}";
    j += ",{\"k\":\"weather_sensors\",\"v\":" + String(g_sensorCount) + ",\"type\":\"count\"}";
    j += "],\"cmds\":\"setup|info|set|device|save|init|autostart|startmesh|reboot|bt off|mesh scan|mesh peers|mesh key|mesh keysend|mesh keygen|mesh enc|weather on|weather off|weather interval|weather add|weather clear|weather now|send|sendto\"";
    j += "}";

    sendMsg(j);
}

static String readLine(Stream &stream)
{
    String line = stream.readStringUntil('\n');
    line.trim();
    return line;
}

static void handleCommand(String raw, bool fromBT);

class RxCB : public BLECharacteristicCallbacks
{
public:
    explicit RxCB(String *target) : _target(target) {}

    void onWrite(BLECharacteristic *c) override
    {
        auto value = c->getValue();
        String incoming = String(value.c_str());
        if (!incoming.length())
            return;

        for (size_t i = 0; i < incoming.length(); i++)
        {
            char ch = incoming[i];
            if (ch == '\r')
                continue;

            if (ch == '\n')
            {
                String line = *_target;
                line.trim();
                _target->remove(0);
                if (line.length())
                    handleCommand(line, true);
                continue;
            }

            *_target += ch;
        }
    }

private:
    String *_target;
};

static void enableBluetoothVisible(const char *name)
{
    if (g_advertising)
        return;

    uint64_t mac = ESP.getEfuseMac();
    uint16_t node = (uint16_t)(mac & 0xFFFF);
    uint32_t base = 0x6E400000 | (uint32_t)node;

    char svc[64], rx[64], tx[64];
    sprintf(svc, "%08X-B5A3-F393-E0A9-E50E24DCCA9E", base | 0x0001);
    sprintf(rx, "%08X-B5A3-F393-E0A9-E50E24DCCA9E", base | 0x0002);
    sprintf(tx, "%08X-B5A3-F393-E0A9-E50E24DCCA9E", base | 0x0003);

    String devName = String(name) + "-" + String(node, HEX);
    BLEDevice::init(devName.c_str());
    BLEServer *server = BLEDevice::createServer();

    class ServerCB : public BLEServerCallbacks
    {
    public:
        void onDisconnect(BLEServer *s) override
        {
            if (s)
                s->startAdvertising();
        }
    };
    server->setCallbacks(new ServerCB());

    BLEService *dynSvc = server->createService(BLEUUID(svc));
    g_rxDyn = dynSvc->createCharacteristic(BLEUUID(rx), BLECharacteristic::PROPERTY_WRITE);
    g_rxDyn->setCallbacks(new RxCB(&g_bleRxDyn));
    g_txDyn = dynSvc->createCharacteristic(BLEUUID(tx), BLECharacteristic::PROPERTY_NOTIFY);
    g_txDyn->addDescriptor(new BLE2902());
    dynSvc->start();

    BLEService *baseSvc = server->createService(BLEUUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E"));
    g_rxBase = baseSvc->createCharacteristic(BLEUUID("6E400002-B5A3-F393-E0A9-E50E24DCCA9E"), BLECharacteristic::PROPERTY_WRITE);
    g_rxBase->setCallbacks(new RxCB(&g_bleRxBase));
    g_txBase = baseSvc->createCharacteristic(BLEUUID("6E400003-B5A3-F393-E0A9-E50E24DCCA9E"), BLECharacteristic::PROPERTY_NOTIFY);
    g_txBase->addDescriptor(new BLE2902());
    baseSvc->start();

    g_advertising = BLEDevice::getAdvertising();
    g_advertising->addServiceUUID(BLEUUID(svc));
    g_advertising->addServiceUUID(BLEUUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E"));
    g_advertising->setScanResponse(true);
    g_advertising->start();
    g_btActive = true;
}

static void disableBluetooth()
{
    if (!g_advertising)
        return;

    g_advertising->stop();
    g_advertising = nullptr;
    g_txDyn = nullptr;
    g_rxDyn = nullptr;
    g_txBase = nullptr;
    g_rxBase = nullptr;
    g_btActive = false;
}

static void sendConfig()
{
    String j = "{";
    j.reserve(420);
    j += "\"device\":\"" + currentProfileKey() + "\"";
    j += ",\"cs\":" + String(g_cfg.csPin);
    j += ",\"reset\":" + String(g_cfg.resetPin);
    j += ",\"busy\":" + String(g_cfg.busyPin);
    j += ",\"dio\":" + String(g_cfg.dioPin);
    j += ",\"freq\":" + String(g_cfg.frequency);
    j += ",\"bw\":" + String(g_cfg.bandwidth);
    j += ",\"sf\":" + String(g_cfg.spreadingFactor);
    j += ",\"cr\":" + String(g_cfg.codingRate);
    j += ",\"sync\":\"0x" + String(g_cfg.syncWord, HEX) + "\"";
    j += ",\"pwr\":" + String(g_cfg.pwr);
    j += ",\"sclk\":" + String(g_cfg.sclkPin);
    j += ",\"miso\":" + String(g_cfg.misoPin);
    j += ",\"mosi\":" + String(g_cfg.mosiPin);
    j += ",\"nss\":" + String(g_cfg.nssPin);
    j += ",\"rst\":" + String(g_cfg.rstPin);
    j += ",\"dio0\":" + String(g_cfg.dio0Pin);
    j += ",\"dio1\":" + String(g_cfg.dio1Pin);
    j += ",\"preamble\":" + String(g_cfg.preambleLength);
    j += ",\"tcxo\":" + String(g_cfg.tcxoVoltage);
    j += ",\"dio2\":" + String(g_cfg.useDio2AsRfSwitch ? 1 : 0);
    j += ",\"bt\":" + String(g_cfg.btEnabled ? 1 : 0);
    j += ",\"mesh_enc\":" + String(g_meshEncryptionEnabled ? 1 : 0);
    j += ",\"weather\":" + String(g_weatherModeEnabled ? 1 : 0);
    j += ",\"weather_interval\":" + String(g_weatherIntervalMs);
    j += ",\"weather_sensors\":" + String(g_sensorCount);
    j += "}";
    sendMsg(j);
}

static void checkInputs()
{
    if (Serial.available())
    {
        String l = readLine(Serial);
        if (l.length())
            handleCommand(l, false);
    }
}

static void startConfigMode()
{
    g_setupMode = true;
    g_setupSaveRequested = false;

    sendMsg("{\"evt\":\"config_mode\"}");
    sendMsg("{\"evt\":\"serial_setup_ready\"}");
    sendSetupInfo();

    uint32_t lastPrompt = millis();
    const uint32_t interval = 5000;

    while (true)
    {
        checkInputs();

        if (g_setupSaveRequested && g_radioReady)
            break;

        if (millis() - lastPrompt >= interval)
        {
            lastPrompt = millis();
            String s = "{\"evt\":\"cfg_status\"";
            s += ",\"setup_active\":true";
            s += ",\"saved\":" + String(g_setupSaveRequested ? "true" : "false");
            s += ",\"radio_ok\":" + String(g_radioReady ? "true" : "false");
            if (!g_setupSaveRequested)
                s += ",\"hint\":\"send save when all fields are correct\"";
            else if (!g_radioReady)
                s += ",\"hint\":\"send init to test radio with current config\"";
            s += "}";
            sendMsg(s);
        }
        delay(20);
    }

    saveConfig();
    sendMsg("{\"evt\":\"config_done\"}");
    ensureMeshRunning(true);
    g_setupMode = false;
}

static void handleCommand(String raw, bool fromBT)
{
    (void)fromBT;

    String rawCmd = raw;
    rawCmd.trim();

    String cmd = rawCmd;
    cmd.toLowerCase();

    if (cmd == "bt on")
    {
        g_cfg.btEnabled = true;
        enableBluetoothVisible("ESP32-LoRaCfg");
        sendMsg("{\"evt\":\"bt_on\"}");
        return;
    }

    if (cmd == "bt off")
    {
        g_cfg.btEnabled = false;
        disableBluetooth();
        sendMsg("{\"evt\":\"bt_off\"}");
        return;
    }

    if (cmd == "help")
    {
        sendMsg("{\"cmds\":\"setup|info|set|device <heltec_v3|megamesh>|save|init|autostart|startmesh|reboot|bt off|mesh scan|mesh peers|mesh key|mesh key <hex>|mesh keysend <nodeId>|mesh keygen|mesh enc <on|off>|weather on|weather off|weather interval <ms>|weather add <pin> <a|d>|weather clear|weather now|send <msg>|sendto <nodeId> <msg>\"}");
        return;
    }

    if (cmd == "show")
    {
        sendConfig();
        return;
    }

    if (cmd == "info")
    {
        sendSetupInfo();
        return;
    }

    if (cmd == "setup")
    {
        if (g_setupMode)
            sendMsg("{\"evt\":\"setup_already\"}");
        else
            startConfigMode();
        return;
    }

    if (cmd.startsWith("device "))
    {
        String deviceType = cmd.substring(7);
        deviceType.trim();

        if (deviceType == "heltec" || deviceType == "heltec_v3")
            setDefaultsHeltec();
        else if (deviceType == "wroom" || deviceType == "megamesh")
            setDefaultsWroom();
        else
        {
            sendMsg("{\"evt\":\"unknown_cmd\"}");
            return;
        }

        sendMsg("{\"evt\":\"defaults_applied\"}");
        sendSetupInfo();
        return;
    }

    if (cmd.startsWith("set "))
    {
        int sep = cmd.indexOf(' ', 4);
        if (sep < 0)
        {
            sendMsg("{\"evt\":\"unknown_cmd\"}");
            return;
        }

        String key = cmd.substring(4, sep);
        String val = cmd.substring(sep + 1);
        key.trim();
        val.trim();

        if (key == "cs")
        {
            g_cfg.csPin = val.toInt();
            g_cfg.nssPin = g_cfg.csPin;
        }
        else if (key == "nss")
        {
            g_cfg.nssPin = val.toInt();
            g_cfg.csPin = g_cfg.nssPin;
        }
        else if (key == "reset")
        {
            g_cfg.resetPin = val.toInt();
            g_cfg.rstPin = g_cfg.resetPin;
        }
        else if (key == "rst")
        {
            g_cfg.rstPin = val.toInt();
            g_cfg.resetPin = g_cfg.rstPin;
        }
        else if (key == "busy")
        {
            g_cfg.busyPin = val.toInt();
            g_cfg.dio0Pin = g_cfg.busyPin;
        }
        else if (key == "dio")
        {
            g_cfg.dioPin = val.toInt();
            g_cfg.dio1Pin = g_cfg.dioPin;
        }
        else if (key == "dio0")
        {
            g_cfg.dio0Pin = val.toInt();
            g_cfg.busyPin = g_cfg.dio0Pin;
        }
        else if (key == "dio1")
        {
            g_cfg.dio1Pin = val.toInt();
            g_cfg.dioPin = g_cfg.dio1Pin;
        }
        else if (key == "sclk")
            g_cfg.sclkPin = val.toInt();
        else if (key == "miso")
            g_cfg.misoPin = val.toInt();
        else if (key == "mosi")
            g_cfg.mosiPin = val.toInt();
        else if (key == "freq")
            g_cfg.frequency = val.toFloat();
        else if (key == "bw")
            g_cfg.bandwidth = val.toFloat();
        else if (key == "sf")
            g_cfg.spreadingFactor = val.toInt();
        else if (key == "cr")
            g_cfg.codingRate = val.toInt();
        else if (key == "pwr")
            g_cfg.pwr = val.toInt();
        else if (key == "sync" || key == "sw")
        {
            if (val.startsWith("0x"))
                g_cfg.syncWord = (uint8_t)strtoul(val.c_str() + 2, nullptr, 16);
            else
                g_cfg.syncWord = val.toInt();
        }
        else if (key == "preamble")
            g_cfg.preambleLength = val.toInt();
        else if (key == "tcxo")
            g_cfg.tcxoVoltage = val.toFloat();
        else if (key == "dio2")
            g_cfg.useDio2AsRfSwitch = (val == "1" || val == "true");
        else if (key == "weather" || key == "wx")
            g_weatherModeEnabled = (val == "1" || val == "true" || val == "on");
        else if (key == "weather_interval" || key == "wxint")
        {
            uint32_t v = (uint32_t)val.toInt();
            g_weatherIntervalMs = v < 500 ? 500 : v;
        }
        else
        {
            sendMsg("{\"evt\":\"unknown_cmd\"}");
            return;
        }

        sendMsg("{\"evt\":\"ok\"}");
        return;
    }

    if (cmd == "save")
    {
        if (!g_setupMode)
        {
            saveConfig();
            sendMsg("{\"evt\":\"cfg_staged\"}");
            return;
        }
        g_setupSaveRequested = true;
        sendMsg("{\"evt\":\"cfg_staged\"}");
        return;
    }

    if (cmd == "init")
    {
        initRadioRobust(true);
        return;
    }

    if (cmd == "autostart")
    {
        if (g_setupMode)
            g_setupSaveRequested = true;
        saveConfig();
        if (ensureMeshRunning(true))
            sendMsg("{\"evt\":\"autostart_ok\"}");
        else
            sendMsg("{\"evt\":\"autostart_err\"}");
        return;
    }

    if (cmd == "startmesh")
    {
        ensureMeshRunning(true);
        return;
    }

    if (cmd == "mesh scan")
    {
        if (!ensureMeshRunning(true))
        {
            sendMsg("{\"evt\":\"radio_not_ready\"}");
            return;
        }
        broadcastDiscovery();
        return;
    }

    if (cmd == "mesh peers")
    {
        sendPeerList();
        return;
    }

    if (cmd == "mesh key")
    {
        sendMsg(String("{\"evt\":\"mesh_key\",\"v\":\"") + meshKeyHex() + "\"}");
        return;
    }

    if (cmd == "mesh keygen")
    {
        for (uint8_t i = 0; i < 16; i += 4)
        {
            uint32_t r = esp_random();
            g_meshKey[i + 0] = (uint8_t)(r & 0xFF);
            g_meshKey[i + 1] = (uint8_t)((r >> 8) & 0xFF);
            g_meshKey[i + 2] = (uint8_t)((r >> 16) & 0xFF);
            g_meshKey[i + 3] = (uint8_t)((r >> 24) & 0xFF);
        }
        sendMsg(String("{\"evt\":\"mesh_key\",\"v\":\"") + meshKeyHex() + "\"}");
        return;
    }

    if (cmd.startsWith("mesh keysend "))
    {
        if (!g_meshRunning || !g_radioReady)
        {
            sendMsg("{\"evt\":\"radio_not_ready\"}");
            return;
        }

        uint16_t dst = (uint16_t)cmd.substring(13).toInt();
        String payload = String("KEY:") + meshKeyHex();
        if (sendMeshPacket(0x30, dst, (const uint8_t *)payload.c_str(), (uint8_t)payload.length()))
            sendMsg(String("{\"evt\":\"mesh_key_tx\",\"dst\":") + dst + "}");
        else
            sendMsg(String("{\"evt\":\"mesh_key_tx_err\",\"dst\":") + dst + "}");
        return;
    }

    if (cmd.startsWith("mesh key "))
    {
        String keyHex = cmd.substring(9);
        uint8_t parsed[16];
        if (!parseHexKey16(keyHex, parsed))
        {
            sendMsg("{\"evt\":\"radio_err\",\"code\":-910}");
            return;
        }
        memcpy(g_meshKey, parsed, 16);
        sendMsg(String("{\"evt\":\"mesh_key\",\"v\":\"") + meshKeyHex() + "\"}");
        sendMsg("{\"evt\":\"ok\"}");
        return;
    }

    if (cmd.startsWith("mesh enc "))
    {
        String mode = cmd.substring(9);
        mode.trim();
        g_meshEncryptionEnabled = (mode == "on" || mode == "1" || mode == "true");
        sendMsg(String("{\"evt\":\"mesh_enc\",\"v\":") + (g_meshEncryptionEnabled ? "1}" : "0}"));
        return;
    }

    if (cmd == "weather on")
    {
        g_weatherModeEnabled = true;
        sendMsg("{\"evt\":\"ok\"}");
        return;
    }

    if (cmd == "weather off")
    {
        g_weatherModeEnabled = false;
        sendMsg("{\"evt\":\"ok\"}");
        return;
    }

    if (cmd.startsWith("weather interval "))
    {
        uint32_t v = (uint32_t)cmd.substring(17).toInt();
        g_weatherIntervalMs = v < 500 ? 500 : v;
        sendMsg("{\"evt\":\"ok\"}");
        return;
    }

    if (cmd.startsWith("weather add "))
    {
        int sep = cmd.indexOf(' ', 12);
        if (sep < 0)
        {
            sendMsg("{\"evt\":\"unknown_cmd\"}");
            return;
        }

        uint8_t pin = (uint8_t)cmd.substring(12, sep).toInt();
        String mode = cmd.substring(sep + 1);
        mode.trim();
        bool analogMode = (mode == "a" || mode == "analog");

        if (!addSensor(pin, analogMode))
            sendMsg("{\"evt\":\"radio_err\",\"code\":-911}");
        else
            sendMsg("{\"evt\":\"ok\"}");
        return;
    }

    if (cmd == "weather clear")
    {
        g_sensorCount = 0;
        sendMsg("{\"evt\":\"ok\"}");
        return;
    }

    if (cmd == "weather now")
    {
        sendWeatherPacket();
        return;
    }

    if (cmd.startsWith("sendto "))
    {
        int sep = cmd.indexOf(' ', 7);
        if (sep < 0)
        {
            sendMsg("{\"evt\":\"unknown_cmd\"}");
            return;
        }

        uint16_t dst = (uint16_t)rawCmd.substring(7, sep).toInt();
        String payload = rawCmd.substring(sep + 1);

        if (sendWebsiteMessage(dst, payload))
            sendMsg(String("{\"evt\":\"msg_tx\",\"dst\":") + dst + ",\"len\":" + payload.length() + "}");
        else
            sendMsg("{\"evt\":\"msg_tx_err\"}");
        return;
    }

    if (cmd.startsWith("send "))
    {
        String payload = rawCmd.substring(5);
        if (sendWebsiteMessage(0xFFFF, payload))
            sendMsg(String("{\"evt\":\"msg_tx\",\"dst\":65535,\"len\":") + payload.length() + "}");
        else
            sendMsg("{\"evt\":\"msg_tx_err\"}");
        return;
    }

    if (cmd == "reboot")
    {
        sendMsg("{\"evt\":\"rebooting\"}");
        delay(200);
        ESP.restart();
        return;
    }

    sendMsg("{\"evt\":\"unknown_cmd\"}");
}

#define DUP_CACHE_SIZE 24
static uint16_t g_dupCache[DUP_CACHE_SIZE] = {0};
static uint8_t g_dupHead = 0;

static bool isDuplicate(uint16_t crc)
{
    for (uint8_t i = 0; i < DUP_CACHE_SIZE; i++)
    {
        if (g_dupCache[i] == crc && crc != 0)
            return true;
    }

    g_dupCache[g_dupHead++] = crc;
    if (g_dupHead >= DUP_CACHE_SIZE)
        g_dupHead = 0;
    return false;
}

static String toHex(const uint8_t *buf, size_t len)
{
    String s;
    s.reserve(len * 2 + 4);
    for (size_t i = 0; i < len; i++)
    {
        uint8_t hi = (buf[i] >> 4) & 0x0F;
        uint8_t lo = buf[i] & 0x0F;
        s += (char)(hi < 10 ? '0' + hi : 'A' + hi - 10);
        s += (char)(lo < 10 ? '0' + lo : 'A' + lo - 10);
    }
    return s;
}

static void handleIncoming(uint8_t *buf, size_t len)
{
    uint16_t crc = crc16_ccitt(buf, len);
    if (isDuplicate(crc))
        return;

    sendMsg(String("{\"evt\":\"rx\",\"len\":") + len + ",\"data\":\"" + toHex(buf, len) + "\"}");
    handleMeshFrame(buf, len);
}

void setup()
{
    Serial.begin(115200);

    loadConfig();
    g_cfg.btEnabled = true;
    enableBluetoothVisible("ESP32-LoRaCfg");
    sendMsg("{\"evt\":\"boot\"}");

    if (!g_configSaved)
    {
        sendMsg("{\"evt\":\"first_boot\"}");
        setDefaultsHeltec();
        if (!g_btActive)
            enableBluetoothVisible("ESP32-LoRaCfg");
        startConfigMode();
    }
    else
    {
        sendMsg("{\"evt\":\"cfg_loaded\"}");
        sendMsg("{\"evt\":\"setup_done\",\"persisted\":true}");
        sendConfig();
        sendSetupInfo();
        sendMsg("{\"evt\":\"setup_available\",\"cmd\":\"setup\"}");
    }
}

void loop()
{
    checkInputs();

    if (g_meshRunning && g_radioReady && g_radio)
    {
        uint8_t buf[256] = {0};
        int16_t state = g_radio->receive(buf, sizeof(buf), 100);
        if (state > 0)
            handleIncoming(buf, (size_t)state);
    }

    if (g_meshRunning && g_weatherModeEnabled)
    {
        uint32_t now = millis();
        if (now - g_lastWeatherTxMs >= g_weatherIntervalMs)
        {
            g_lastWeatherTxMs = now;
            sendWeatherPacket();
        }
    }

    delay(20);
}

static uint16_t crc16_ccitt(const uint8_t *data, size_t len)
{
    uint16_t crc = 0xFFFF;
    while (len--)
    {
        crc ^= (uint16_t)(*data++) << 8;
        for (uint8_t i = 0; i < 8; i++)
        {
            if (crc & 0x8000)
                crc = (crc << 1) ^ 0x1021;
            else
                crc <<= 1;
        }
    }
    return crc;
}
