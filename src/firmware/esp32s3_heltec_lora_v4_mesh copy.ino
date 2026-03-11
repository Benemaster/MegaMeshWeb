////////////////////////////////////////////////////////////////////////////////////
// This code is primaraly designed for educational purpose as a school Projekt    //
// ------------------------------------------------------------------------------ //
// The current configuration is optimised for Heltec Lora 32 v4(4.0)              //
// ------------------------------------------------------------------------------ //
// Authers:                                                                       //
// Flavius Linnhoff   @https://github.com/Flavours64                              //
// Benedict Gropp     @https://github.com/Benemaster                              //
// ------------------------------------------------------------------------------ //
// Project Name: MegaMesh                                                         //
// GitHub Projekt Page:                                                           //
// GitHub Web Client:                                                             //
// ------------------------------------------------------------------------------ //
// Basic explenation of the project:                                              //
//                                                                                //
// This project trys to create a indipendent scaleble meshcommunication network   //
// for weather data and many other data types. Key features are security and      //
// scalebility. It supports multiple options for useres to use and interact with  //
// this firmware via spezific hardware or with every Chrome or Edge Browser or    //
// an AndroidApp.                                                                 //
//                                                                                //
// ------------------------------------------------------------------------------ //
// !!! This is only a small part of the project and it will not be easy to use    //
// !!! setup. There is no setup instruction or dokumentation avalible.            //
//                                                                                //
////////////////////////////////////////////////////////////////////////////////////

#include <mbedtls/aes.h> // AES library for encryption
#include <Arduino.h>     // Main Arduino library
#include <SPI.h>         // SPI library for communication with the LoRa module
#include <RadioLib.h>    // RadioLib library for LoRa communication
#include <BLEDevice.h>   // BLE library for Bluetooth communication
#include <BLEServer.h>   // BLE server library for handling Bluetooth server functionality
#include <BLE2902.h>     // BLE descriptor library for handling Bluetooth descriptors
#include <Preferences.h> // NVS flash storage for persistent settings
#include <esp_sleep.h>   // ESP32 sleep modes
#include <driver/gpio.h> // GPIO wakeup for light sleep

// Pin definitions for the LoRa module
static const uint8_t PIN_NSS = 8;
static const uint8_t PIN_SCK = 9;
static const uint8_t PIN_MOSI = 10;
static const uint8_t PIN_MISO = 11;
static const uint8_t PIN_RST = 12;
static const uint8_t PIN_BUSY = 13;
static const uint8_t PIN_DIO1 = 14;

// Battery monitoring pins (Heltec V4)
static const uint8_t PIN_VBAT_ADC = 1;  // Battery voltage ADC (GPIO1)
static const uint8_t PIN_ADC_CTRL = 37; // ADC enable – LOW to activate divider

// BOOT button: GPIO0, active LOW, hardware pull-up to 3.3 V
static const uint8_t PIN_BOOT_BTN = 0;

// LoRa configuration parameters
static const float LORA_FREQUENCY = 869.4;
static const float LORA_BANDWIDTH = 125.0;
static const uint8_t LORA_SF = 9;
static const uint8_t LORA_CR = 7;
static const uint8_t LORA_SYNC_WORD = 0x12;
static int8_t loraPower = 17; // mutable for runtime adjustment
static const uint16_t LORA_PREAMBLE = 8;
static const float LORA_TCXO_VOLTAGE = 1.6;

// Mesh network configuration parameters
static const uint16_t MESH_MAGIC = 0x4D48;
static const uint8_t MESH_VERSION = 1;
static const uint16_t MESH_BROADCAST = 0xFFFF;
static const size_t MAX_MESH_PAYLOAD = 180;
static const size_t MAX_PACKET_SIZE = 220;
static const uint8_t DEFAULT_MAX_HOPS = 7;
static const uint8_t SEEN_CACHE_SIZE = 64;
static const uint8_t STATION_CACHE_SIZE = 32;
static const uint8_t KEY_CACHE_SIZE = 24;
static const uint8_t KEY_BYTES = 16;
static const uint8_t MESH_FLAG_ENCRYPTED = 0x01;

// Default public channel key
// channel works out of the box 32 hex = 16 bytes
static const uint8_t PUBLIC_KEY[KEY_BYTES] = {
    0x4D, 0x45, 0x47, 0x41, 0x4D, 0x45, 0x53, 0x48,
    0x50, 0x55, 0x42, 0x4C, 0x49, 0x43, 0x30, 0x31}; // "MEGAMESHPUBLIC01"
static const char *CTRL_DISC_REQ = "#MESH_DISC_REQ";
static const char *CTRL_DISC_RESP = "#MESH_DISC_RESP";
static const char *CTRL_WX_REQ = "#MESH_WX_REQ";
static const char *CTRL_WX_DATA = "#MESH_WX_DATA";
static const char *CTRL_ACK = "#MESH_ACK";
static const char *CTRL_TRACE_REQ = "#MESH_TRACE_REQ";
static const char *CTRL_TRACE_RESP = "#MESH_TRACE_RESP";

// Reliable send configuration
static const uint8_t OUTBOUND_BUFFER_SIZE = 8;
static const uint8_t MAX_RETRIES = 10;
static const uint32_t RETRY_INTERVAL_MS = 5000;

// Data structures for mesh network management
struct SeenEntry
{
    uint16_t origin;
    uint16_t msgId;
    uint32_t seenAt;
};

// Data structure for storing information about stations in the mesh network
struct StationEntry
{
    uint16_t node;
    uint32_t lastSeen;
    float rssi;
    float snr;
    uint8_t hops;
};

// Data structure for storing peer keys for encryption
struct PeerKeyEntry
{
    bool valid;
    uint16_t node;
    uint8_t key[KEY_BYTES];
};

// Data structure for the mesh packet header
#pragma pack(push, 1)
struct MeshHeader
{
    uint16_t magic;
    uint8_t version;
    uint16_t origin;
    uint16_t msgId;
    uint16_t destination;
    uint8_t hopCount;
    uint8_t maxHops;
    uint8_t flags;
    uint8_t payloadLen;
};
#pragma pack(pop)

// Data structure for outbound message buffer (reliable send)
struct OutboundEntry
{
    bool active;
    MeshHeader header;
    uint8_t payload[MAX_MESH_PAYLOAD];
    uint8_t retries;
    uint32_t lastSentAt;
};

// RadioLib setup for the LoRa module
Module radioModule(PIN_NSS, PIN_DIO1, PIN_RST, PIN_BUSY);
SX1262 radio(&radioModule);

// Global variables for managing the mesh network state
volatile bool radioIrq = false;
uint16_t nodeId = 0;
uint16_t nextMsgId = 1;
uint8_t configuredMaxHops = DEFAULT_MAX_HOPS;
bool weatherModeEnabled = false;
String serialLine;
SeenEntry seenCache[SEEN_CACHE_SIZE];
uint8_t seenWritePos = 0;
StationEntry stations[STATION_CACHE_SIZE];
PeerKeyEntry peerKeys[KEY_CACHE_SIZE];
bool personalKeyValid = false;
uint8_t personalKey[KEY_BYTES] = {0};

// Reliable send buffer
OutboundEntry outboundBuffer[OUTBOUND_BUFFER_SIZE];
bool reliableSendEnabled = true;

// Sleep mode configuration
bool sleepModeEnabled = false;
static const uint64_t SLEEP_MAINTENANCE_US = 5000000ULL; // 5 s timer wakeup for retries/maintenance
static const uint32_t SLEEP_IDLE_MS = 200;               // idle time before sleep

// Weather station location
float wxLatitude = 0.0; // i love Gleitkommazahlen und das ist irgendwo im meer
float wxLongitude = 0.0;
bool wxLocationSet = false;

// Bluetooth characteristic
BLECharacteristic *pTxChar = nullptr;
volatile bool bleConnected = false;

// BLE advertising timeout: active for 3 minutes after boot or button press
static const uint32_t BLE_ADV_TIMEOUT_MS = 180000UL;
bool bleAdvActive = false;
uint32_t bleAdvStartedAt = 0;
volatile bool bleAdvRestartPending = false; // set from BLE task, handled in loop()

// BLE command ring buffer
#define BLE_CMD_QUEUE_SIZE 16
String bleCmdQueue[BLE_CMD_QUEUE_SIZE];
volatile uint8_t bleCmdHead = 0;
volatile uint8_t bleCmdTail = 0;

// Offline inbox: store up to 10 messages addressed to this node while BLE is disconnected
#define INBOX_SIZE 10
struct InboxEntry
{
    bool used;
    uint16_t origin;
    uint16_t msgId;
    uint8_t hops;
    uint8_t maxHops;
    float rssi;
    float snr;
    bool encrypted;
    char text[MAX_MESH_PAYLOAD + 1];
};
InboxEntry inbox[INBOX_SIZE];
uint8_t inboxWritePos = 0;

// Persistent settings (NVS flash)
static const uint32_t SETTINGS_MAGIC = 0x4D534859; // 'MSHY' – bumped when struct layout changed
static const uint32_t SAVE_DEBOUNCE_MS = 3000;     // coalesce rapid changes

#pragma pack(push, 1)
struct PersistentSettings
{
    uint32_t magic;
    uint16_t nodeId; // assigned on first boot, fixed for device lifetime
    uint8_t maxHops;
    int8_t txPower;
    bool weatherMode;
    bool reliableSend;
    bool sleepMode;
    bool personalKeyValid;
    uint8_t personalKey[16]; // KEY_BYTES
    float wxLatitude;
    float wxLongitude;
    bool wxLocationSet;
    uint8_t peerKeyCount;
    // inline peer keys (node + key) – up to KEY_CACHE_SIZE entries
    struct
    {
        bool valid;
        uint16_t node;
        uint8_t key[16];
    } peers[24]; // KEY_CACHE_SIZE
};
#pragma pack(pop)

Preferences nvs;
bool settingsDirty = false;
uint32_t settingsDirtyAt = 0; // millis() when first dirtied

// dual output class for serial and BLE for shorter code
class DualPrint : public Print
{
    String _bleBuf;

public:
    size_t write(uint8_t c) override
    {
        Serial.write(c);
        if (bleConnected && pTxChar)
        {
            _bleBuf += (char)c;
            if (c == '\n')
                flushBLE();
        }
        return 1;
    }
    size_t write(const uint8_t *buf, size_t len) override
    {
        Serial.write(buf, len);
        if (bleConnected && pTxChar)
            for (size_t i = 0; i < len; i++)
            {
                _bleBuf += (char)buf[i];
                if (buf[i] == '\n')
                    flushBLE();
            }
        return len;
    }
    void flushBLE()
    {
        while (_bleBuf.length() > 0)
        {
            size_t n = _bleBuf.length() < 200 ? _bleBuf.length() : 200;
            pTxChar->setValue((uint8_t *)_bleBuf.c_str(), n);
            pTxChar->notify();
            _bleBuf = _bleBuf.substring(n);
            delay(5);
        }
    }
};
DualPrint out;

// Settings persistence helpers

void markSettingsDirty()
{
    if (!settingsDirty)
    {
        settingsDirty = true;
        settingsDirtyAt = millis();
    }
}

// Build a snapshot of current RAM state into a PersistentSettings blob
void buildSettingsBlob(PersistentSettings &s)
{
    memset(&s, 0, sizeof(s));
    s.magic = SETTINGS_MAGIC;
    s.nodeId = nodeId;
    s.maxHops = configuredMaxHops;
    s.txPower = loraPower;
    s.weatherMode = weatherModeEnabled;
    s.reliableSend = reliableSendEnabled;
    s.sleepMode = sleepModeEnabled;
    s.personalKeyValid = personalKeyValid;
    memcpy(s.personalKey, personalKey, KEY_BYTES);
    s.wxLatitude = wxLatitude;
    s.wxLongitude = wxLongitude;
    s.wxLocationSet = wxLocationSet;
    s.peerKeyCount = 0;
    for (uint8_t i = 0; i < KEY_CACHE_SIZE; i++)
    {
        s.peers[i].valid = peerKeys[i].valid;
        s.peers[i].node = peerKeys[i].node;
        memcpy(s.peers[i].key, peerKeys[i].key, KEY_BYTES);
        if (peerKeys[i].valid)
            s.peerKeyCount++;
    }
}

// Write settings to NVS only if the blob actually changed (reduces flash wear)
void saveSettingsToFlash()
{
    PersistentSettings s;
    buildSettingsBlob(s);

    // compare-before-write: read existing blob and skip if identical
    nvs.begin("meshcfg", true); // read-only
    size_t existingLen = nvs.getBytesLength("settings");
    bool same = false;
    if (existingLen == sizeof(s))
    {
        uint8_t *existing = (uint8_t *)malloc(sizeof(s));
        if (existing)
        {
            nvs.getBytes("settings", existing, sizeof(s));
            same = (memcmp(existing, &s, sizeof(s)) == 0);
            free(existing);
        }
    }
    nvs.end();

    if (same)
    {
        settingsDirty = false;
        return;
    }

    nvs.begin("meshcfg", false); // read-write
    nvs.putBytes("settings", &s, sizeof(s));
    nvs.end();
    settingsDirty = false;
    out.println("[FLASH] Settings saved.");
}

// Load settings from NVS flash into RAM; returns true if valid settings were found
bool loadSettingsFromFlash()
{
    nvs.begin("meshcfg", true);
    size_t len = nvs.getBytesLength("settings");
    if (len != sizeof(PersistentSettings))
    {
        nvs.end();
        return false;
    }

    PersistentSettings s;
    nvs.getBytes("settings", &s, sizeof(s));
    nvs.end();

    if (s.magic != SETTINGS_MAGIC)
        return false;

    nodeId = s.nodeId;
    configuredMaxHops = s.maxHops;
    loraPower = s.txPower;
    weatherModeEnabled = s.weatherMode;
    reliableSendEnabled = s.reliableSend;
    sleepModeEnabled = s.sleepMode;
    personalKeyValid = s.personalKeyValid;
    memcpy(personalKey, s.personalKey, KEY_BYTES);
    wxLatitude = s.wxLatitude;
    wxLongitude = s.wxLongitude;
    wxLocationSet = s.wxLocationSet;

    for (uint8_t i = 0; i < KEY_CACHE_SIZE; i++)
    {
        peerKeys[i].valid = s.peers[i].valid;
        peerKeys[i].node = s.peers[i].node;
        memcpy(peerKeys[i].key, s.peers[i].key, KEY_BYTES);
    }

    return true;
}

// Called from loop() – only writes if dirty and debounce interval has passed
void saveSettingsIfNeeded()
{
    if (!settingsDirty)
        return;
    if (millis() - settingsDirtyAt < SAVE_DEBOUNCE_MS)
        return;
    saveSettingsToFlash();
}

// Store a received directed message in the offline inbox
void storeInbox(uint16_t origin, uint16_t msgId, uint8_t hops, uint8_t maxH,
                float rssi, float snr, bool enc, const char *text)
{
    InboxEntry &e = inbox[inboxWritePos];
    e.used = true;
    e.origin = origin;
    e.msgId = msgId;
    e.hops = hops;
    e.maxHops = maxH;
    e.rssi = rssi;
    e.snr = snr;
    e.encrypted = enc;
    strncpy(e.text, text, MAX_MESH_PAYLOAD);
    e.text[MAX_MESH_PAYLOAD] = '\0';
    inboxWritePos = (inboxWritePos + 1) % INBOX_SIZE;
}

// Flush all stored inbox messages over BLE
void flushInbox()
{
    for (uint8_t i = 0; i < INBOX_SIZE; i++)
    {
        if (!inbox[i].used)
            continue;
        InboxEntry &e = inbox[i];
        out.print("RX origin=");
        out.print(e.origin, HEX);
        out.print(" dest=0x");
        out.print(nodeId, HEX);
        out.print(" msgId=");
        out.print(e.msgId);
        out.print(" hops=");
        out.print(e.hops);
        out.print("/");
        out.print(e.maxHops);
        out.print(" rssi=");
        out.print(e.rssi);
        out.print(" snr=");
        out.print(e.snr);
        out.print(" enc=");
        out.print(e.encrypted ? 1 : 0);
        out.print(" text=");
        out.println(e.text);
        e.used = false;
        delay(20); // small gap between messages
    }
}

// Flag to flush inbox on next loop iteration (set from BLE callback)
volatile bool pendingInboxFlush = false;

// BLE advertising helpers – always call these instead of BLEDevice:: directly
void startBLEAdvertising()
{
    BLEDevice::startAdvertising();
    bleAdvActive = true;
    bleAdvStartedAt = millis();
}

void stopBLEAdvertising()
{
    BLEDevice::stopAdvertising();
    bleAdvActive = false;
}

class MeshBLEServerCB : public BLEServerCallbacks
{
    void onConnect(BLEServer *s) override
    {
        bleConnected = true;
        pendingInboxFlush = true; // schedule flush for next loop()
    }
    void onDisconnect(BLEServer *s) override
    {
        bleConnected = false;
        // Do NOT call startBLEAdvertising() here – this runs on the BLE FreeRTOS
        // task and calling BLEDevice API from it can deadlock. Set a flag instead.
        bleAdvRestartPending = true;
    }
};

class MeshBLERxCB : public BLECharacteristicCallbacks
{
    void onWrite(BLECharacteristic *c) override
    {
        String v = String(c->getValue().c_str());
        v.trim();
        if (v.length() > 0)
        {
            uint8_t nextHead = (bleCmdHead + 1) % BLE_CMD_QUEUE_SIZE;
            if (nextHead != bleCmdTail) // queue not full
            {
                bleCmdQueue[bleCmdHead] = v;
                bleCmdHead = nextHead;
            }
        }
    }
};

bool parseNodeValue(const String &input, uint16_t &outNode)
{
    String raw = input;
    raw.trim();
    if (raw.length() == 0)
    {
        return false;
    }

    char *endPtr = nullptr;
    unsigned long parsed = strtoul(raw.c_str(), &endPtr, 0);
    if (endPtr == raw.c_str() || *endPtr != '\0' || parsed > 0xFFFF)
    {
        return false;
    }

    outNode = static_cast<uint16_t>(parsed);
    return true;
}

int hexNibble(char c)
{
    if (c >= '0' && c <= '9')
        return c - '0';
    if (c >= 'a' && c <= 'f')
        return 10 + (c - 'a');
    if (c >= 'A' && c <= 'F')
        return 10 + (c - 'A');
    return -1;
}

String keyToHex(const uint8_t *key)
{
    const char *digits = "0123456789ABCDEF";
    String out;
    out.reserve(KEY_BYTES * 2);
    for (uint8_t i = 0; i < KEY_BYTES; i++)
    {
        out += digits[(key[i] >> 4) & 0x0F];
        out += digits[key[i] & 0x0F];
    }
    return out;
}

bool parseHexKey(String raw, uint8_t *outKey)
{
    raw.trim();
    if (raw.startsWith("0x") || raw.startsWith("0X"))
    {
        raw = raw.substring(2);
    }

    if (raw.length() != KEY_BYTES * 2)
    {
        return false;
    }

    for (uint8_t i = 0; i < KEY_BYTES; i++)
    {
        int hi = hexNibble(raw[i * 2]);
        int lo = hexNibble(raw[i * 2 + 1]);
        if (hi < 0 || lo < 0)
        {
            return false;
        }
        outKey[i] = static_cast<uint8_t>((hi << 4) | lo);
    }

    return true;
}

void generatePersonalKey()
{
    for (uint8_t i = 0; i < KEY_BYTES; i++)
    {
        personalKey[i] = static_cast<uint8_t>(random(0, 256));
    }
    personalKeyValid = true;
}

int findPeerKeyIndex(uint16_t node)
{
    for (uint8_t i = 0; i < KEY_CACHE_SIZE; i++)
    {
        if (peerKeys[i].valid && peerKeys[i].node == node)
        {
            return i;
        }
    }
    return -1;
}

int findPeerKeyFreeSlot()
{
    for (uint8_t i = 0; i < KEY_CACHE_SIZE; i++)
    {
        if (!peerKeys[i].valid)
        {
            return i;
        }
    }
    return -1;
}

bool setPeerKey(uint16_t node, const uint8_t *key)
{
    int index = findPeerKeyIndex(node);
    if (index < 0)
    {
        index = findPeerKeyFreeSlot();
    }
    if (index < 0)
    {
        return false;
    }

    peerKeys[index].valid = true;
    peerKeys[index].node = node;
    memcpy(peerKeys[index].key, key, KEY_BYTES);
    return true;
}

bool deletePeerKey(uint16_t node)
{
    int index = findPeerKeyIndex(node);
    if (index < 0)
    {
        return false;
    }

    peerKeys[index].valid = false;
    peerKeys[index].node = 0;
    memset(peerKeys[index].key, 0, KEY_BYTES);
    return true;
}

void printPeerKeys()
{
    out.println("Gespeicherte Node-Keys:");
    bool any = false;
    for (uint8_t i = 0; i < KEY_CACHE_SIZE; i++)
    {
        if (!peerKeys[i].valid)
        {
            continue;
        }
        any = true;
        out.print("- node=0x");
        out.print(peerKeys[i].node, HEX);
        out.print(" key=");
        out.println(keyToHex(peerKeys[i].key));
    }
    if (!any)
    {
        out.println("(keine)");
    }
}

// Battery voltage helpers (Heltec V4)

float readBatteryVoltage()
{
    pinMode(PIN_ADC_CTRL, OUTPUT);
    digitalWrite(PIN_ADC_CTRL, LOW); // enable voltage divider
    delay(10);
    uint32_t raw = analogReadMilliVolts(PIN_VBAT_ADC);
    digitalWrite(PIN_ADC_CTRL, HIGH); // disable to save power

    float voltage = raw * 2.0f / 1000.0f;
    return voltage;
}

uint8_t batteryPercent(float voltage)
{
    // LiPo approximation: 4.2V = 100%, 3.0V = 0% // Li ion is unpredictable for me
    if (voltage >= 4.2f)
        return 100;
    if (voltage <= 3.0f)
        return 0;
    return static_cast<uint8_t>((voltage - 3.0f) / 1.2f * 100.0f);
}

void printBatteryInfo()
{
    float v = readBatteryVoltage();
    uint8_t pct = batteryPercent(v);
    out.print("Battery: ");
    out.print(v, 2);
    out.print("V (");
    out.print(pct);
    out.println("%)");
}

// Lightsleep helpers (DIO1 wakeup)

void enterLightSleep()
{
    // Wake on DIO1 HIGH (LoRa packet received)
    gpio_wakeup_enable(static_cast<gpio_num_t>(PIN_DIO1), GPIO_INTR_HIGH_LEVEL);
    esp_sleep_enable_gpio_wakeup();
    // Also wake on timer for maintenance (retry buffer, serial, etc.)
    esp_sleep_enable_timer_wakeup(SLEEP_MAINTENANCE_US);
    esp_light_sleep_start();
}

void cryptPayload(uint8_t *buffer, size_t len, const uint8_t *key, const MeshHeader &header)
{
    // Initialize the AES context
    mbedtls_aes_context aes;
    mbedtls_aes_init(&aes);

    // AES key setup (128)
    mbedtls_aes_setkey_enc(&aes, key, 128);

    uint8_t iv[16] = {0};

    iv[0] = (header.origin >> 8) & 0xFF;
    iv[1] = header.origin & 0xFF;
    iv[2] = (header.destination >> 8) & 0xFF;
    iv[3] = header.destination & 0xFF;
    iv[4] = (header.msgId >> 8) & 0xFF;
    iv[5] = header.msgId & 0xFF;

    // Variables for mbedtls
    size_t nc_off = 0;
    uint8_t stream_block[16] = {0};

    // CTR mode
    mbedtls_aes_crypt_ctr(&aes, len, &nc_off, iv, stream_block, buffer, buffer);

    // clean to prevent memory leaks
    mbedtls_aes_free(&aes);
}

int findStationIndex(uint16_t node)
{
    for (uint8_t index = 0; index < STATION_CACHE_SIZE; index++)
    {
        if (stations[index].node == node)
        {
            return index;
        }
    }
    return -1;
}

void updateStation(uint16_t node, float rssi, float snr, uint8_t hops)
{
    int slot = findStationIndex(node);
    if (slot < 0)
    {
        for (uint8_t index = 0; index < STATION_CACHE_SIZE; index++)
        {
            if (stations[index].node == 0)
            {
                slot = index;
                break;
            }
        }
    }

    if (slot < 0)
    {
        uint8_t oldest = 0;
        for (uint8_t index = 1; index < STATION_CACHE_SIZE; index++)
        {
            if (stations[index].lastSeen < stations[oldest].lastSeen)
            {
                oldest = index;
            }
        }
        slot = oldest;
    }

    stations[slot].node = node;
    stations[slot].lastSeen = millis();
    stations[slot].rssi = rssi;
    stations[slot].snr = snr;
    stations[slot].hops = hops;
}

void printStations()
{
    out.println("Gefundene Stationen:");
    bool any = false;
    uint32_t nowMs = millis();
    for (uint8_t index = 0; index < STATION_CACHE_SIZE; index++)
    {
        if (stations[index].node == 0)
        {
            continue;
        }
        any = true;
        out.print("- 0x");
        out.print(stations[index].node, HEX);
        out.print(" last=");
        out.print((nowMs - stations[index].lastSeen) / 1000UL);
        out.print("s rssi=");
        out.print(stations[index].rssi);
        out.print(" snr=");
        out.print(stations[index].snr);
        out.print(" hops=");
        out.println(stations[index].hops);
    }

    if (!any)
    {
        out.println("(keine)");
    }
}

#if defined(ESP8266) || defined(ESP32)
ICACHE_RAM_ATTR
#endif
void setRadioFlag(void)
{
    radioIrq = true;
}

bool wasSeen(uint16_t origin, uint16_t msgId)
{
    const uint32_t nowMs = millis();
    for (uint8_t index = 0; index < SEEN_CACHE_SIZE; index++)
    {
        if (seenCache[index].origin == origin && seenCache[index].msgId == msgId)
        {
            if (nowMs - seenCache[index].seenAt < 120000UL)
            {
                return true;
            }
        }
    }
    return false;
}

void rememberSeen(uint16_t origin, uint16_t msgId)
{
    seenCache[seenWritePos].origin = origin;
    seenCache[seenWritePos].msgId = msgId;
    seenCache[seenWritePos].seenAt = millis();
    seenWritePos = (seenWritePos + 1) % SEEN_CACHE_SIZE;
}

void restartReceive()
{
    radioIrq = false;
    int16_t state = radio.startReceive();
    if (state != RADIOLIB_ERR_NONE)
    {
        out.print("RX start error: ");
        out.println(state);
    }
}

bool sendMeshFrame(MeshHeader &header, const uint8_t *payload)
{
    const size_t totalLen = sizeof(MeshHeader) + header.payloadLen;
    if (totalLen > MAX_PACKET_SIZE)
    {
        return false;
    }

    uint8_t frame[MAX_PACKET_SIZE];
    memcpy(frame, &header, sizeof(MeshHeader));
    if (header.payloadLen > 0)
    {
        memcpy(frame + sizeof(MeshHeader), payload, header.payloadLen);
    }

    int16_t txState = radio.transmit(frame, totalLen);
    if (txState != RADIOLIB_ERR_NONE)
    {
        out.print("TX error: ");
        out.println(txState);
        restartReceive();
        return false;
    }

    restartReceive();
    return true;
}

// Outgoing message buffer management for reliable send(optoional feature)
int findFreeOutboundSlot()
{
    for (uint8_t i = 0; i < OUTBOUND_BUFFER_SIZE; i++)
    {
        if (!outboundBuffer[i].active)
            return i;
    }
    return -1;
}

bool bufferOutboundMessage(const MeshHeader &hdr, const uint8_t *payload)
{
    int slot = findFreeOutboundSlot();
    if (slot < 0)
    {
        out.println("Outbound buffer full message sent without ACK tracking.");
        return false;
    }
    outboundBuffer[slot].active = true;
    outboundBuffer[slot].header = hdr;
    memcpy(outboundBuffer[slot].payload, payload, hdr.payloadLen);
    outboundBuffer[slot].retries = 0;
    outboundBuffer[slot].lastSentAt = millis();
    return true;
}

void removeOutboundByMsgId(uint16_t origin, uint16_t msgId)
{
    for (uint8_t i = 0; i < OUTBOUND_BUFFER_SIZE; i++)
    {
        if (outboundBuffer[i].active &&
            outboundBuffer[i].header.origin == origin &&
            outboundBuffer[i].header.msgId == msgId)
        {
            outboundBuffer[i].active = false;
            out.print("ACK received msgId=");
            out.print(msgId);
            out.println(" removed from buffer.");
            return;
        }
    }
}

void processOutboundBuffer()
{
    if (!reliableSendEnabled)
        return;

    uint32_t now = millis();
    for (uint8_t i = 0; i < OUTBOUND_BUFFER_SIZE; i++)
    {
        if (!outboundBuffer[i].active)
            continue;

        if (now - outboundBuffer[i].lastSentAt < RETRY_INTERVAL_MS)
            continue;

        outboundBuffer[i].retries++;
        if (outboundBuffer[i].retries > MAX_RETRIES)
        {
            out.print("FAILED msgId=");
            out.print(outboundBuffer[i].header.msgId);
            out.print(" to=0x");
            out.print(outboundBuffer[i].header.destination, HEX);
            out.println(" - no ACK after 10 retries, dropped.");
            outboundBuffer[i].active = false;
            continue;
        }

        out.print("RETRY #");
        out.print(outboundBuffer[i].retries);
        out.print(" msgId=");
        out.print(outboundBuffer[i].header.msgId);
        out.print(" to=0x");
        out.println(outboundBuffer[i].header.destination, HEX);

        sendMeshFrame(outboundBuffer[i].header, outboundBuffer[i].payload);
        outboundBuffer[i].lastSentAt = now;
    }
}

void printOutboundBuffer()
{
    out.println("Outbound buffer:");
    bool any = false;
    for (uint8_t i = 0; i < OUTBOUND_BUFFER_SIZE; i++)
    {
        if (!outboundBuffer[i].active)
            continue;
        any = true;
        out.print("- msgId=");
        out.print(outboundBuffer[i].header.msgId);
        out.print(" to=0x");
        out.print(outboundBuffer[i].header.destination, HEX);
        out.print(" retries=");
        out.print(outboundBuffer[i].retries);
        out.print("/");
        out.println(MAX_RETRIES);
    }
    if (!any)
        out.println("(empty)");
}

// Forward declaration
bool sendTextTo(uint16_t destination, const String &text, bool encrypted = false);

// ACK helper

void sendAck(uint16_t destination, uint16_t ackedOrigin, uint16_t ackedMsgId)
{
    String payload = String(CTRL_ACK) + ":" +
                     String(ackedOrigin, HEX) + ":" +
                     String(ackedMsgId);
    sendTextTo(destination, payload);
}

// Trace route helpers

void sendTraceRoute(uint16_t destination)
{
    if (destination == MESH_BROADCAST)
    {
        out.println("Traceroute requires a specific node ID.");
        return;
    }
    // Payload: "#MESH_TRACE_REQ:0xOrigin"
    String payload = String(CTRL_TRACE_REQ) + ":0x" + String(nodeId, HEX);
    if (sendTextTo(destination, payload))
    {
        out.print("TRACEROUTE sent to 0x");
        out.println(destination, HEX);
    }
}

bool sendTextTo(uint16_t destination, const String &text, bool encrypted)
{
    if (text.length() == 0)
    {
        return false;
    }

    String payloadText = text;
    if (payloadText.length() > MAX_MESH_PAYLOAD)
    {
        payloadText = payloadText.substring(0, MAX_MESH_PAYLOAD);
    }

    MeshHeader header;
    header.magic = MESH_MAGIC;
    header.version = MESH_VERSION;
    header.origin = nodeId;
    header.msgId = nextMsgId++;
    header.destination = destination;
    header.hopCount = 0;
    header.maxHops = configuredMaxHops;
    header.flags = encrypted ? MESH_FLAG_ENCRYPTED : 0;
    header.payloadLen = static_cast<uint8_t>(payloadText.length());

    uint8_t payloadBytes[MAX_MESH_PAYLOAD];
    memcpy(payloadBytes, payloadText.c_str(), header.payloadLen);
    if (encrypted)
    {
        if (!personalKeyValid)
        {
            out.println("Kein eigener Key. Nutze: /mykey gen");
            return false;
        }
        cryptPayload(payloadBytes, header.payloadLen, personalKey, header);
    }

    rememberSeen(header.origin, header.msgId);
    bool sent = sendMeshFrame(header, payloadBytes);

    // Buffer for reliable delivery if enabled, directed, and not a control/ACK message
    if (sent && reliableSendEnabled &&
        destination != MESH_BROADCAST &&
        !payloadText.startsWith("#MESH_"))
    {
        bufferOutboundMessage(header, payloadBytes);
    }

    return sent;
}

void sendDiscoveryRequest()
{
    if (sendTextTo(MESH_BROADCAST, String(CTRL_DISC_REQ)))
    {
        out.println("SCAN gesendet: warte auf Antworten...");
    }
}

void sendDiscoveryResponse(uint16_t destination)
{
    String payload = String(CTRL_DISC_RESP) + ":" + String(nodeId, HEX);
    sendTextTo(destination, payload);
}

String weatherInfo()
{
    float temperature = 21.5f;
    float humidity = 48.0f;
    float pressure = 1012.8f;

    String payload = String(CTRL_WX_DATA);
    payload += ":node=0x";
    payload += String(nodeId, HEX);
    payload += ",tempC=";
    payload += String(temperature, 1);
    payload += ",hum=";
    payload += String(humidity, 1);
    payload += ",hPa=";
    payload += String(pressure, 1);
    if (wxLocationSet)
    {
        payload += ",lat=";
        payload += String(wxLatitude, 6);
        payload += ",lon=";
        payload += String(wxLongitude, 6);
    }
    return payload;
}

void sendWeatherRequest(uint16_t destination)
{
    if (sendTextTo(destination, String(CTRL_WX_REQ)))
    {
        out.print("WX request gesendet an ");
        if (destination == MESH_BROADCAST)
        {
            out.println("broadcast");
        }
        else
        {
            out.print("0x");
            out.println(destination, HEX);
        }
    }
}

void sendWeatherResponse(uint16_t destination)
{
    String payload = weatherInfo();
    if (sendTextTo(destination, payload))
    {
        out.print("WX response gesendet an 0x");
        out.println(destination, HEX);
    }
}

void sendUserMessage(const String &message)
{
    if (message.length() == 0)
    {
        return;
    }

    String payloadText = message;
    if (payloadText.length() > MAX_MESH_PAYLOAD)
    {
        payloadText = payloadText.substring(0, MAX_MESH_PAYLOAD);
    }

    if (sendTextTo(MESH_BROADCAST, payloadText))
    {
        uint16_t sentMsgId = static_cast<uint16_t>(nextMsgId - 1);
        out.print("TX msgId=");
        out.print(sentMsgId);
        out.print(" hops=");
        out.print(0);
        out.print("/");
        out.print(configuredMaxHops);
        out.print(" text=");
        out.println(payloadText);
    }
}

void sendDirectMessage(uint16_t destination, const String &message)
{
    if (message.length() == 0)
    {
        return;
    }

    String payloadText = message;
    if (payloadText.length() > MAX_MESH_PAYLOAD)
    {
        payloadText = payloadText.substring(0, MAX_MESH_PAYLOAD);
    }

    if (sendTextTo(destination, payloadText, false))
    {
        uint16_t sentMsgId = static_cast<uint16_t>(nextMsgId - 1);
        out.print("TX to=0x");
        out.print(destination, HEX);
        out.print(" msgId=");
        out.print(sentMsgId);
        out.print(" text=");
        out.println(payloadText);
    }
}

void sendCryptedDirektMassage(uint16_t destination, const String &message)
{
    if (destination == MESH_BROADCAST)
    {
        out.println("Verschluesselt nur als Direktnachricht erlaubt.");
        return;
    }

    String payloadText = message;
    if (payloadText.length() > MAX_MESH_PAYLOAD)
    {
        payloadText = payloadText.substring(0, MAX_MESH_PAYLOAD);
    }

    if (sendTextTo(destination, payloadText, true))
    {
        uint16_t sentMsgId = static_cast<uint16_t>(nextMsgId - 1);
        out.print("ETX to=0x");
        out.print(destination, HEX);
        out.print(" msgId=");
        out.print(sentMsgId);
        out.print(" text=");
        out.println(payloadText);
    }
}

void sendPublicMessage(const String &message)
{
    if (message.length() == 0) // fixes wierd bug due to overflow idont know why but removing brings it back
    {
        return;
    }

    String payloadText = message;
    if (payloadText.length() > MAX_MESH_PAYLOAD)
    {
        payloadText = payloadText.substring(0, MAX_MESH_PAYLOAD);
    }

    MeshHeader header;
    header.magic = MESH_MAGIC;
    header.version = MESH_VERSION;
    header.origin = nodeId;
    header.msgId = nextMsgId++;
    header.destination = MESH_BROADCAST;
    header.hopCount = 0;
    header.maxHops = configuredMaxHops;
    header.flags = MESH_FLAG_ENCRYPTED;
    header.payloadLen = static_cast<uint8_t>(payloadText.length());

    uint8_t payloadBytes[MAX_MESH_PAYLOAD];
    memcpy(payloadBytes, payloadText.c_str(), header.payloadLen);
    cryptPayload(payloadBytes, header.payloadLen, PUBLIC_KEY, header);

    rememberSeen(header.origin, header.msgId);
    if (sendMeshFrame(header, payloadBytes))
    {
        uint16_t sentMsgId = static_cast<uint16_t>(nextMsgId - 1);
        out.print("TX msgId=");
        out.print(sentMsgId);
        out.print(" hops=0/");
        out.print(configuredMaxHops);
        out.print(" enc=pub text=");
        out.println(payloadText);
    }
}

void relayIfNeeded(const MeshHeader &incoming, const uint8_t *payload, bool alreadySeen, const char *decodedText = nullptr)
{
    if (alreadySeen)
    {
        return;
    }
    if (incoming.hopCount >= incoming.maxHops)
    {
        return;
    }

    MeshHeader relay = incoming;
    relay.hopCount = incoming.hopCount + 1;
    rememberSeen(relay.origin, relay.msgId);

    // Special handling: append our node ID to trace route requests before relaying
    if (decodedText != nullptr)
    {
        String txt(decodedText);
        if (txt.startsWith(String(CTRL_TRACE_REQ)))
        {
            // Append our nodeId to the route path
            String newPayload = txt + ">0x" + String(nodeId, HEX);
            if (newPayload.length() <= MAX_MESH_PAYLOAD)
            {
                relay.payloadLen = static_cast<uint8_t>(newPayload.length());
                uint8_t modifiedPayload[MAX_MESH_PAYLOAD];
                memcpy(modifiedPayload, newPayload.c_str(), relay.payloadLen);
                if (sendMeshFrame(relay, modifiedPayload))
                {
                    out.print("RELAY TRACE origin=");
                    out.print(relay.origin, HEX);
                    out.print(" hops=");
                    out.print(relay.hopCount);
                    out.print("/");
                    out.println(relay.maxHops);
                }
                return;
            }
        }
    }

    if (sendMeshFrame(relay, payload))
    {
        out.print("RELAY origin=");
        out.print(relay.origin, HEX);
        out.print(" msgId=");
        out.print(relay.msgId);
        out.print(" hops=");
        out.print(relay.hopCount);
        out.print("/");
        out.println(relay.maxHops);
    }
}

void handleReceivedPacket()
{
    const size_t packetLen = radio.getPacketLength();
    if (packetLen < sizeof(MeshHeader) || packetLen > MAX_PACKET_SIZE)
    {
        restartReceive();
        return;
    }

    uint8_t frame[MAX_PACKET_SIZE];
    int16_t state = radio.readData(frame, packetLen);
    if (state != RADIOLIB_ERR_NONE)
    {
        out.print("RX error: ");
        out.println(state);
        restartReceive();
        return;
    }

    MeshHeader header;
    memcpy(&header, frame, sizeof(MeshHeader));
    if (header.magic != MESH_MAGIC || header.version != MESH_VERSION)
    {
        restartReceive();
        return;
    }

    const size_t announcedPayloadLen = header.payloadLen;
    const size_t actualPayloadLen = packetLen - sizeof(MeshHeader);
    const size_t payloadLen = announcedPayloadLen < actualPayloadLen ? announcedPayloadLen : actualPayloadLen;
    const uint8_t *payloadPtr = frame + sizeof(MeshHeader);
    bool alreadySeen = wasSeen(header.origin, header.msgId);
    float rssi = radio.getRSSI();
    float snr = radio.getSNR();

    if (!alreadySeen)
    {
        rememberSeen(header.origin, header.msgId);
    }

    if (header.origin != nodeId)
    {
        updateStation(header.origin, rssi, snr, header.hopCount);
    }

    // Decode payload outside the destination check so relay can use it for trace route
    bool decryptedYeah = true;
    char textBuffer[MAX_MESH_PAYLOAD + 1];
    textBuffer[0] = '\0';
    const size_t copyLen = payloadLen <= MAX_MESH_PAYLOAD ? payloadLen : MAX_MESH_PAYLOAD;

    if (header.destination == MESH_BROADCAST || header.destination == nodeId)
    {
        bool encrypted = (header.flags & MESH_FLAG_ENCRYPTED) != 0;
        uint8_t payloadWork[MAX_MESH_PAYLOAD];

        memcpy(payloadWork, payloadPtr, copyLen);
        if (encrypted)
        {
            int keyIndex = findPeerKeyIndex(header.origin);
            if (keyIndex >= 0)
            {
                // Decrypt with stored peer key
                cryptPayload(payloadWork, copyLen, peerKeys[keyIndex].key, header);
            }
            else if (header.destination == MESH_BROADCAST)
            {
                // Broadcast without peer key — try public key
                cryptPayload(payloadWork, copyLen, PUBLIC_KEY, header);
            }
            else
            {
                decryptedYeah = false;
            }
        }

        char textBuffer[MAX_MESH_PAYLOAD + 1];
        memcpy(textBuffer, payloadWork, copyLen);
        textBuffer[copyLen] = '\0';

        out.print("RX origin=");
        out.print(header.origin, HEX);
        out.print(" dest=");
        if (header.destination == MESH_BROADCAST)
            out.print("broadcast");
        else
        {
            out.print("0x");
            out.print(header.destination, HEX);
        }
        out.print(" msgId=");
        out.print(header.msgId);
        out.print(" hops=");
        out.print(header.hopCount);
        out.print("/");
        out.print(header.maxHops);
        out.print(" rssi=");
        out.print(rssi);
        out.print(" snr=");
        out.print(snr);
        out.print(" enc=");
        out.print(encrypted ? 1 : 0);
        out.print(" text=");
        if (encrypted && !decryptedYeah)
        {
            out.println("<encrypted: key fehlt fuer origin>");
        }
        else
        {
            out.println(textBuffer);
        }

        String payloadText = decryptedYeah ? String(textBuffer) : String("");

        // Handle ACK messages
        if (decryptedYeah && payloadText.startsWith(String(CTRL_ACK)) && header.destination == nodeId)
        {
            // Format: #MESH_ACK:<originHex>:<msgId>
            int firstColon = payloadText.indexOf(':', String(CTRL_ACK).length());
            if (firstColon > 0)
            {
                int secondColon = payloadText.indexOf(':', firstColon + 1);
                if (secondColon > 0)
                {
                    String originStr = payloadText.substring(firstColon + 1, secondColon);
                    String msgIdStr = payloadText.substring(secondColon + 1);
                    uint16_t ackedOrigin = static_cast<uint16_t>(strtoul(originStr.c_str(), nullptr, 16));
                    uint16_t ackedMsgId = static_cast<uint16_t>(msgIdStr.toInt());
                    removeOutboundByMsgId(ackedOrigin, ackedMsgId);
                }
            }
        }

        // ── Handle trace route request (we are the destination) ──────
        if (!alreadySeen && decryptedYeah && payloadText.startsWith(String(CTRL_TRACE_REQ)) && header.destination == nodeId && header.origin != nodeId)
        {
            // Append ourselves and send back as TRACE_RESP
            String route = payloadText.substring(String(CTRL_TRACE_REQ).length() + 1); // skip ':'
            route += ">0x" + String(nodeId, HEX);
            String respPayload = String(CTRL_TRACE_RESP) + ":" + route;
            sendTextTo(header.origin, respPayload);
            out.print("TRACEROUTE arrived from 0x");
            out.print(header.origin, HEX);
            out.print(" route=");
            out.println(route);
        }

        // Handle trace route response (this is origin)
        if (decryptedYeah && payloadText.startsWith(String(CTRL_TRACE_RESP)) && header.destination == nodeId)
        {
            String route = payloadText.substring(String(CTRL_TRACE_RESP).length() + 1);
            out.print("TRACEROUTE to 0x");
            out.print(header.origin, HEX);
            out.print(": ");
            out.println(route);
        }

        // Handle discovery
        if (!alreadySeen && decryptedYeah && payloadText == CTRL_DISC_REQ && header.origin != nodeId)
        {
            sendDiscoveryResponse(header.origin);
        }
        else if (decryptedYeah && payloadText.startsWith(String(CTRL_DISC_RESP)) && header.origin != nodeId)
        {
            out.print("DISCOVERED station=0x");
            out.print(header.origin, HEX);
            out.print(" hops=");
            out.print(header.hopCount);
            out.print(" rssi=");
            out.print(rssi);
            out.print(" snr=");
            out.println(snr);
        }

        // Handle weather
        if (!alreadySeen && decryptedYeah && payloadText == CTRL_WX_REQ && header.origin != nodeId && weatherModeEnabled)
        {
            sendWeatherResponse(header.origin);
        }
        else if (decryptedYeah && payloadText.startsWith(String(CTRL_WX_DATA)) && header.origin != nodeId)
        {
            out.print("WEATHER from=0x");
            out.print(header.origin, HEX);
            out.print(" hops=");
            out.print(header.hopCount);
            out.print(" data=");
            out.println(payloadText);
        }

        // Auto-ACK for directed non-control user messages
        if (!alreadySeen && decryptedYeah && header.destination == nodeId &&
            header.origin != nodeId && !payloadText.startsWith("#MESH_"))
        {
            sendAck(header.origin, header.origin, header.msgId);
            // Store in offline inbox if BLE is not connected
            if (!bleConnected)
            {
                bool encrypted = (header.flags & MESH_FLAG_ENCRYPTED) != 0;
                storeInbox(header.origin, header.msgId, header.hopCount,
                           header.maxHops, rssi, snr, encrypted, textBuffer);
            }
        }
    }
    else
    {
        // packet not for this node but logging and potential relay
        bool encrypted = (header.flags & MESH_FLAG_ENCRYPTED) != 0;
        if (!encrypted)
        {
            memcpy(textBuffer, payloadPtr, copyLen);
            textBuffer[copyLen] = '\0';
        }
        else
        {
            decryptedYeah = false;
        }
    }

    relayIfNeeded(header, payloadPtr, alreadySeen, decryptedYeah ? textBuffer : nullptr);

    restartReceive();
}

void printHelp()
{
    out.println("Mesh Serial Commands:");
    out.println("/help              -> Hilfe anzeigen");
    out.println("/id                -> eigene Node-ID");
    out.println("/ttl <1..15>       -> maxHops ");
    out.println("/scan              -> Stationen suchen");
    out.println("/stations          -> gefundene Stationen anzeigen");
    out.println("/msg <id> <text>   -> Direktnachricht (unverschluesselt)");
    out.println("/wx on|off|status  -> Weather-Mode steuern");
    out.println("/wxreq [all|node]  -> Wetterdaten anfragen");
    out.println("/wxloc <lat> <lon> -> Standort fuer Weather-Mode setzen");
    out.println("/wxloc show        -> aktuellen Standort anzeigen");
    out.println("/mykey gen|show|set-> eigener Key fuer eigene Node-ID");
    out.println("/key set <id> <hex32> -> Key fuer fremde Node-ID speichern");
    out.println("/key del <id>      -> Key fuer Node-ID loeschen");
    out.println("/keys              -> gespeicherte Keys anzeigen");
    out.println("/eto <id> <text>   -> verschluesselte Direktnachricht");
    out.println("/pub <text>        -> oeffentliche Nachricht (Public Key)");
    out.println("/traceroute <id>   -> Route zu einer Node anzeigen");
    out.println("/reliable on|off|status -> Zuverlaessiges Senden ein/aus");
    out.println("/buffer            -> Outbound-Buffer anzeigen");
    out.println("/battery           -> Batteriespannung anzeigen");
    out.println("/txpower <2..22>   -> TX Power in dBm setzen");
    out.println("/sleep on|off|status -> Schlafmodus (DIO1 wakeup)");
    out.println("/save              -> Einstellungen sofort auf Flash speichern");
    out.println("/settings          -> alle Einstellungen anzeigen (JSON)");
    out.println("jede andere Zeile  -> als Mesh-Nachricht senden");
}

void handleSerialLine(String line)
{
    line.trim();
    if (line.length() == 0)
    {
        return;
    }

    if (line == "/help")
    {
        printHelp();
        return;
    }

    // settings dump for externals and console
    if (line == "/settings")
    {

        out.print("{\"nodeId\":\"0x");
        out.print(nodeId, HEX);
        out.print("\",\"maxHops\":");
        out.print(configuredMaxHops);
        out.print(",\"weatherMode\":");
        out.print(weatherModeEnabled ? "true" : "false");
        out.print(",\"personalKeyValid\":");
        out.print(personalKeyValid ? "true" : "false");
        if (personalKeyValid)
        {
            out.print(",\"personalKey\":\"");
            out.print(keyToHex(personalKey));
            out.print("\"");
        }
        out.print(",\"loraFreq\":");
        out.print(LORA_FREQUENCY);
        out.print(",\"loraBW\":");
        out.print(LORA_BANDWIDTH);
        out.print(",\"loraSF\":");
        out.print(LORA_SF);
        out.print(",\"loraCR\":");
        out.print(LORA_CR);
        out.print(",\"loraPower\":");
        out.print(loraPower);
        out.print(",\"bleConnected\":");
        out.print(bleConnected ? "true" : "false");
        int nKeys = 0;
        for (uint8_t i = 0; i < KEY_CACHE_SIZE; i++)
            if (peerKeys[i].valid)
                nKeys++;
        out.print(",\"peerKeys\":");
        out.print(nKeys);
        int nSta = 0;
        for (uint8_t i = 0; i < STATION_CACHE_SIZE; i++)
            if (stations[i].node)
                nSta++;
        out.print(",\"stations\":");
        out.print(nSta);
        out.print(",\"reliableSend\":");
        out.print(reliableSendEnabled ? "true" : "false");
        int nBuf = 0;
        for (uint8_t i = 0; i < OUTBOUND_BUFFER_SIZE; i++)
            if (outboundBuffer[i].active)
                nBuf++;
        out.print(",\"outboundBuffered\":");
        out.print(nBuf);
        out.print(",\"sleepMode\":");
        out.print(sleepModeEnabled ? "true" : "false");
        float batV = readBatteryVoltage();
        out.print(",\"batteryV\":");
        out.print(batV, 2);
        out.print(",\"batteryPct\":");
        out.print(batteryPercent(batV));
        out.print(",\"settingsDirty\":");
        out.print(settingsDirty ? "true" : "false");
        out.println("}");
        return;
    }

    if (line == "/id")
    {
        out.print("Node ID: 0x");
        out.println(nodeId, HEX);
        return;
    }

    if (line.startsWith("/ttl "))
    {
        int requested = line.substring(5).toInt();
        if (requested >= 1 && requested <= 15)
        {
            configuredMaxHops = static_cast<uint8_t>(requested);
            markSettingsDirty();
            out.print("maxHops gesetzt auf ");
            out.println(configuredMaxHops);
        }
        else
        {
            out.println("Ungueltiger Wert. Erlaubt: 1..15");
        }
        return;
    }

    if (line.startsWith("/txpower "))
    {
        int requested = line.substring(9).toInt();
        if (requested >= 2 && requested <= 28)
        {
            loraPower = static_cast<int8_t>(requested);
            radio.setOutputPower(loraPower);
            markSettingsDirty();
            out.print("TX Power gesetzt auf ");
            out.print(loraPower);
            out.println(" dBm");
        }
        else
        {
            out.println("passt net");
        }
        return;
    }

    if (line == "/scan")
    {
        sendDiscoveryRequest();
        return;
    }

    if (line == "/stations")
    {
        printStations();
        return;
    }

    if (line == "/wx on")
    {
        weatherModeEnabled = true;
        markSettingsDirty();
        out.println("Weather-Mode: ON");
        return;
    }

    if (line == "/wx off")
    {
        weatherModeEnabled = false;
        markSettingsDirty();
        out.println("Weather-Mode: OFF");
        return;
    }

    if (line == "/wx status")
    {
        out.print("Weather-Mode: ");
        out.println(weatherModeEnabled ? "ON" : "OFF");
        return;
    }

    if (line == "/wxreq" || line == "/wxreq all")
    {
        sendWeatherRequest(MESH_BROADCAST);
        return;
    }

    if (line.startsWith("/wxreq "))
    {
        uint16_t targetNode = 0;
        String targetToken = line.substring(7);
        targetToken.trim();
        if (parseNodeValue(targetToken, targetNode))
        {
            sendWeatherRequest(targetNode);
        }
        else
        {
            out.println("Ungueltiges Node-Format. Beispiel: /wxreq 0x12AF");
        }
        return;
    }

    if (line == "/mykey gen")
    {
        generatePersonalKey();
        markSettingsDirty();
        out.println("Eigener Key neu generiert.");
        out.print("Fuer andere Node fuer ID 0x");
        out.print(nodeId, HEX);
        out.print(" setzen mit: /key set 0x");
        out.print(nodeId, HEX);
        out.print(" ");
        out.println(keyToHex(personalKey));
        return;
    }

    if (line.startsWith("/mykey set "))
    {
        String keyToken = line.substring(11);
        keyToken.trim();
        uint8_t parsedKey[KEY_BYTES];
        if (!parseHexKey(keyToken, parsedKey))
        {
            out.println("Ungueltiger Key. Erwartet 32 Hex-Zeichen.");
            return;
        }
        memcpy(personalKey, parsedKey, KEY_BYTES);
        personalKeyValid = true;
        markSettingsDirty();
        out.print("Eigener Key gesetzt: ");
        out.println(keyToHex(personalKey));
        out.print("Fuer andere Node fuer ID 0x");
        out.print(nodeId, HEX);
        out.print(" setzen mit: /key set 0x");
        out.print(nodeId, HEX);
        out.print(" ");
        out.println(keyToHex(personalKey));
        return;
    }

    if (line == "/mykey show")
    {
        if (!personalKeyValid)
        {
            out.println("Kein eigener Key gesetzt. Nutze: /mykey gen");
        }
        else
        {
            out.print("Eigener Key fuer ID 0x");
            out.print(nodeId, HEX);
            out.print(": ");
            out.println(keyToHex(personalKey));
        }
        return;
    }

    if (line == "/keys")
    {
        printPeerKeys();
        return;
    }

    if (line.startsWith("/key set "))
    {
        String rest = line.substring(9);
        rest.trim();
        int split = rest.indexOf(' ');
        if (split <= 0)
        {
            out.println("Syntax: /key set <nodeId> <hex32>");
            return;
        }

        String nodeToken = rest.substring(0, split);
        String keyToken = rest.substring(split + 1);
        nodeToken.trim();
        keyToken.trim();

        uint16_t keyNode = 0;
        uint8_t parsedKey[KEY_BYTES];
        if (!parseNodeValue(nodeToken, keyNode))
        {
            out.println("Ungueltige Node-ID.");
            return;
        }
        if (!parseHexKey(keyToken, parsedKey))
        {
            out.println("Ungueltiger Key. Erwartet 32 Hex-Zeichen.");
            return;
        }

        if (!setPeerKey(keyNode, parsedKey))
        {
            out.println("Key-Speicher voll.");
            return;
        }

        markSettingsDirty();
        out.print("Key gespeichert fuer Node 0x");
        out.println(keyNode, HEX);
        return;
    }

    if (line.startsWith("/key del "))
    {
        uint16_t keyNode = 0;
        String nodeToken = line.substring(9);
        nodeToken.trim();
        if (!parseNodeValue(nodeToken, keyNode))
        {
            out.println("Ungueltige Node-ID.");
            return;
        }

        if (deletePeerKey(keyNode))
        {
            markSettingsDirty();
            out.print("Key geloescht fuer Node 0x");
            out.println(keyNode, HEX);
        }
        else
        {
            out.println("Kein Key fuer diese Node vorhanden.");
        }
        return;
    }

    if (line.startsWith("/msg "))
    {
        String rest = line.substring(5);
        rest.trim();
        int split = rest.indexOf(' ');
        if (split <= 0)
        {
            out.println("Syntax: /msg <nodeId> <text>");
            return;
        }

        String nodeToken = rest.substring(0, split);
        String textToken = rest.substring(split + 1);
        nodeToken.trim();
        textToken.trim();

        uint16_t targetNode = 0;
        if (!parseNodeValue(nodeToken, targetNode))
        {
            out.println("Ungueltige Node-ID.");
            return;
        }

        sendDirectMessage(targetNode, textToken);
        return;
    }

    if (line.startsWith("/pub "))
    {
        String text = line.substring(5);
        text.trim();
        if (text.length() == 0)
        {
            out.println("Syntax: /pub <text>");
            return;
        }
        sendPublicMessage(text);
        return;
    }

    if (line.startsWith("/eto "))
    {
        String rest = line.substring(5);
        rest.trim();
        int split = rest.indexOf(' ');
        if (split <= 0)
        {
            out.println("Syntax: /eto <nodeId> <text>");
            return;
        }

        String nodeToken = rest.substring(0, split);
        String textToken = rest.substring(split + 1);
        nodeToken.trim();
        textToken.trim();

        uint16_t targetNode = 0;
        if (!parseNodeValue(nodeToken, targetNode))
        {
            out.println("Ungueltige Node-ID.");
            return;
        }

        sendCryptedDirektMassage(targetNode, textToken);
        return;
    }

    if (line.startsWith("/wxloc "))
    {
        String rest = line.substring(7);
        rest.trim();

        if (rest == "show")
        {
            if (wxLocationSet)
            {
                out.print("WX Location: lat=");
                out.print(wxLatitude, 6);
                out.print(" lon=");
                out.println(wxLongitude, 6);
            }
            else
            {
                out.println("Kein Standort gesetzt. Nutze: /wxloc <lat> <lon>");
            }
            return;
        }

        int split = rest.indexOf(' ');
        if (split <= 0)
        {
            out.println("Syntax: /wxloc <lat> <lon> oder /wxloc show");
            return;
        }

        String latToken = rest.substring(0, split);
        String lonToken = rest.substring(split + 1);
        latToken.trim();
        lonToken.trim();

        wxLatitude = latToken.toFloat();
        wxLongitude = lonToken.toFloat();
        wxLocationSet = true;
        markSettingsDirty();

        out.print("WX Location gesetzt: lat=");
        out.print(wxLatitude, 6);
        out.print(" lon=");
        out.println(wxLongitude, 6);
        return;
    }

    // Traceroute command
    if (line.startsWith("/traceroute "))
    {
        String nodeToken = line.substring(12);
        nodeToken.trim();
        uint16_t targetNode = 0;
        if (!parseNodeValue(nodeToken, targetNode))
        {
            out.println("Ungueltige Node-ID. Beispiel: /traceroute 0x12AF");
            return;
        }
        sendTraceRoute(targetNode);
        return;
    }

    // Reliable send toggle
    if (line == "/reliable on")
    {
        reliableSendEnabled = true;
        markSettingsDirty();
        out.println("Reliable send: ON");
        return;
    }

    if (line == "/reliable off")
    {
        reliableSendEnabled = false;
        // Clear buffer when off
        for (uint8_t i = 0; i < OUTBOUND_BUFFER_SIZE; i++)
            outboundBuffer[i].active = false;
        markSettingsDirty();
        out.println("Reliable send: OFF (buffer cleared)");
        return;
    }

    if (line == "/reliable status")
    {
        out.print("Reliable send: ");
        out.println(reliableSendEnabled ? "ON" : "OFF");
        return;
    }

    // Show outbound buffer
    if (line == "/buffer")
    {
        printOutboundBuffer();
        return;
    }

    // Battery command
    if (line == "/battery")
    {
        printBatteryInfo();
        return;
    }

    // Sleep mode toggle
    if (line == "/sleep on")
    {
        sleepModeEnabled = true;
        markSettingsDirty();
        out.println("Sleep mode: ON (light-sleep with DIO1 wakeup)");
        return;
    }

    if (line == "/sleep off")
    {
        sleepModeEnabled = false;
        markSettingsDirty();
        out.println("Sleep mode: OFF");
        return;
    }

    if (line == "/sleep status")
    {
        out.print("Sleep mode: ");
        out.println(sleepModeEnabled ? "ON" : "OFF");
        return;
    }

    // Force-save settings to flash
    if (line == "/save")
    {
        saveSettingsToFlash();
        return;
    }

    sendUserMessage(line);
}

void readSerialInput()
{
    while (Serial.available())
    {
        char c = static_cast<char>(Serial.read());
        if (c == '\r')
        {
            continue;
        }
        if (c == '\n')
        {
            String line = serialLine;
            serialLine = "";
            handleSerialLine(line);
            continue;
        }

        if (serialLine.length() < MAX_MESH_PAYLOAD)
        {
            serialLine += c;
        }
    }
}

void setup()
{
    Serial.begin(115200);
    // For ESP32-S3 native USB CDC: wait up to 3 s for a host to attach.
    // With a USB-UART bridge this exits immediately (Serial is always ready).
    {
        uint32_t _t = millis();
        while (!Serial && millis() - _t < 3000)
        {
            delay(10);
        }
    }
    delay(200);

    uint64_t mac = ESP.getEfuseMac();
    // Derive a MAC-based ID as fallback before we try to load from flash
    uint16_t macDerivedId = static_cast<uint16_t>(mac & 0xFFFF);
    randomSeed(static_cast<unsigned long>(micros()) ^ static_cast<unsigned long>(macDerivedId));

    // Load persistent settings from flash (before radio init so loraPower is used)
    bool settingsLoaded = loadSettingsFromFlash();
    if (settingsLoaded)
    {
        // Guard: old firmware had a bug that kept saving nodeId=0.
        // If we loaded a zero ID, regenerate it from the MAC.
        if (nodeId == 0)
        {
            nodeId = macDerivedId;
            markSettingsDirty();
            out.println("[FLASH] Recovered zero nodeId from MAC.");
        }
        else
        {
            out.println("[FLASH] Settings restored.");
        }
    }
    else
    {
        // First boot: assign node ID from MAC and persist it immediately
        nodeId = macDerivedId;
        out.println("[FLASH] First boot node ID assigned and saved.");
        saveSettingsToFlash();
    }

    SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_NSS);

    int16_t state = radio.begin(
        LORA_FREQUENCY,
        LORA_BANDWIDTH,
        LORA_SF,
        LORA_CR,
        LORA_SYNC_WORD,
        loraPower,
        LORA_PREAMBLE,
        LORA_TCXO_VOLTAGE,
        false);

    if (state != RADIOLIB_ERR_NONE)
    {
        out.print("LoRa init Fehler: ");
        out.println(state);
        out.println("Bitte Pins und TCXO-Spannung pruefen. Reset erforderlich.");
        // Keep printing so the error is visible even when serial is opened late.
        while (true)
        {
            delay(5000);
            out.print("[STUCK] LoRa init Fehler: ");
            out.println(state);
        }
    }

    radio.setDio1Action(setRadioFlag);

    // Apply restored TX power if it differs from the radio init default
    if (settingsLoaded)
        radio.setOutputPower(loraPower);

    restartReceive();

    // BOOT button – configure before BLE so it can be read immediately
    pinMode(PIN_BOOT_BTN, INPUT_PULLUP);

    // BLE setup – device name includes the node ID so it is recognisable in scan lists
    char bleName[24];
    snprintf(bleName, sizeof(bleName), "MegaMesh-%04X", nodeId);
    BLEDevice::init(bleName);
    BLEServer *pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MeshBLEServerCB());
    BLEService *pSvc = pServer->createService("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    pTxChar = pSvc->createCharacteristic("6E400003-B5A3-F393-E0A9-E50E24DCCA9E", BLECharacteristic::PROPERTY_NOTIFY);
    pTxChar->addDescriptor(new BLE2902());
    BLECharacteristic *pRxChar = pSvc->createCharacteristic("6E400002-B5A3-F393-E0A9-E50E24DCCA9E", BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    pRxChar->setCallbacks(new MeshBLERxCB());
    pSvc->start();
    startBLEAdvertising(); // records start time for the 3-minute timeout

    // print info at startup
    out.println("Mesh gestartet ");
    out.print("Node ID: 0x");
    out.println(nodeId, HEX);
    out.print("Weather-Mode: ");
    out.println(weatherModeEnabled ? "ON" : "OFF");
    out.println("Encryption: /mykey gen for eigenen Node-Key");
    out.print("BLE: ");
    out.print(bleName);
    out.println(" (aktiv 3 min, BOOT-Taste zum Reaktivieren)");
    out.print("Sleep mode: ");
    out.println(sleepModeEnabled ? "ON" : "OFF");
    out.print("TX Power: ");
    out.print(loraPower);
    out.println(" dBm");
    out.print("maxHops: ");
    out.println(configuredMaxHops);
    printBatteryInfo();
    out.print("Pins NSS/SCK/MOSI/MISO/RST/BUSY/DIO1: ");
    out.print(PIN_NSS);
    out.print("/");
    out.print(PIN_SCK);
    out.print("/");
    out.print(PIN_MOSI);
    out.print("/");
    out.print(PIN_MISO);
    out.print("/");
    out.print(PIN_RST);
    out.print("/");
    out.print(PIN_BUSY);
    out.print("/");
    out.println(PIN_DIO1);
    printHelp();
}

void loop()
{
    readSerialInput();

    // Debounced write of dirty settings to flash
    saveSettingsIfNeeded();

    // Restart advertising after a client disconnects (flag set by BLE task)
    if (bleAdvRestartPending)
    {
        bleAdvRestartPending = false;
        startBLEAdvertising();
    }
    // Stop advertising after the 3-minute timeout
    if (bleAdvActive && !bleConnected && millis() - bleAdvStartedAt > BLE_ADV_TIMEOUT_MS)
    {
        stopBLEAdvertising();
        out.println("[BLE] visibility gestoppt. BOOT-Taste druecken zum Reaktivieren.");
    }

    {
        static uint32_t btnLowSince = 0;
        if (digitalRead(PIN_BOOT_BTN) == LOW)
        {
            if (btnLowSince == 0)
                btnLowSince = millis();
            else if (!bleAdvActive && !bleConnected && millis() - btnLowSince > 50)
            {
                btnLowSince = 0;
                startBLEAdvertising();
                out.println("[BLE] Advertising reaktiviert (BOOT-Taste).");
            }
        }
        else
        {
            btnLowSince = 0;
        }
    }

    // Process all queued BLE commands
    while (bleCmdHead != bleCmdTail)
    {
        String cmd = bleCmdQueue[bleCmdTail];
        bleCmdTail = (bleCmdTail + 1) % BLE_CMD_QUEUE_SIZE;
        handleSerialLine(cmd);
    }

    // Flush offline inbox when BLE just connected
    if (pendingInboxFlush && bleConnected)
    {
        pendingInboxFlush = false;
        delay(800); // let BLE stabilize (MTU negotiation etc.)
        flushInbox();
    }

    if (radioIrq)
    {
        radioIrq = false;
        handleReceivedPacket();
    }

    // Process outbound retry buffer
    processOutboundBuffer();

    // Enter light sleep if enabled and nothing pending
    if (sleepModeEnabled && !radioIrq && !Serial.available() && bleCmdHead == bleCmdTail)
    {
        delay(SLEEP_IDLE_MS); // small guard so serial chars can arrive
        if (!radioIrq && !Serial.available() && bleCmdHead == bleCmdTail)
        {
            enterLightSleep();
            // startingpoint wakeup
        }
    }
}
