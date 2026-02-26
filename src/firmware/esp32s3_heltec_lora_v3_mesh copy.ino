////////////////////////////////////////////////////////////////////////////////////
// This code is primaraly designed for educational purpose as a school Projekt    //
// ------------------------------------------------------------------------------ //
// The current configuration is optimised for Heltec Lora 32 v3(3.2)              //
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

// Pin definitions for the LoRa module
static const uint8_t PIN_NSS = 8;
static const uint8_t PIN_SCK = 9;
static const uint8_t PIN_MOSI = 10;
static const uint8_t PIN_MISO = 11;
static const uint8_t PIN_RST = 12;
static const uint8_t PIN_BUSY = 13;
static const uint8_t PIN_DIO1 = 14;

// LoRa configuration parameters
static const float LORA_FREQUENCY = 868.0;
static const float LORA_BANDWIDTH = 125.0;
static const uint8_t LORA_SF = 9;
static const uint8_t LORA_CR = 7;
static const uint8_t LORA_SYNC_WORD = 0x12;
static const int8_t LORA_POWER = 17;
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
static const char *CTRL_DISC_REQ = "#MESH_DISC_REQ";
static const char *CTRL_DISC_RESP = "#MESH_DISC_RESP";
static const char *CTRL_WX_REQ = "#MESH_WX_REQ";
static const char *CTRL_WX_DATA = "#MESH_WX_DATA";

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

// RadioLib instance for the LoRa module
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

// Bluetooth characteristic
BLECharacteristic *pTxChar = nullptr;
bool bleConnected = false;
String blePendingCmd;
bool bleCmdReady = false;

// dual output class for serial and BLE for shorter code and better readability
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

class MeshBLEServerCB : public BLEServerCallbacks
{
    void onConnect(BLEServer *s) override { bleConnected = true; }
    void onDisconnect(BLEServer *s) override
    {
        bleConnected = false;
        BLEDevice::startAdvertising();
    }
};

class MeshBLERxCB : public BLECharacteristicCallbacks
{
    void onWrite(BLECharacteristic *c) override
    {
        String v = String(c->getValue().c_str());
        v.trim();
        if (v.length() > 0 && !bleCmdReady)
        {
            blePendingCmd = v;
            bleCmdReady = true;
        }
    }
}; //

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

bool sendTextTo(uint16_t destination, const String &text, bool encrypted = false)
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
    return sendMeshFrame(header, payloadBytes);
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
    payload += ",placeholder=1";
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

void relayIfNeeded(const MeshHeader &incoming, const uint8_t *payload, bool alreadySeen)
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

    if (header.destination == MESH_BROADCAST || header.destination == nodeId)
    {
        bool encrypted = (header.flags & MESH_FLAG_ENCRYPTED) != 0;
        bool decryptedYeah = true;
        uint8_t payloadWork[MAX_MESH_PAYLOAD];
        const size_t copyLen = payloadLen <= MAX_MESH_PAYLOAD ? payloadLen : MAX_MESH_PAYLOAD;

        memcpy(payloadWork, payloadPtr, copyLen);
        if (encrypted)
        {
            int keyIndex = findPeerKeyIndex(header.origin);
            if (keyIndex < 0)
            {
                decryptedYeah = false;
            }
            else
            {
                cryptPayload(payloadWork, copyLen, peerKeys[keyIndex].key, header);
            }
        }

        char textBuffer[MAX_MESH_PAYLOAD + 1];
        memcpy(textBuffer, payloadWork, copyLen);
        textBuffer[copyLen] = '\0';

        out.print("RX origin=");
        out.print(header.origin, HEX);
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
    }

    relayIfNeeded(header, payloadPtr, alreadySeen);
}

void printHelp()
{
    out.println("Mesh Serial Commands:");
    out.println("/help              -> Hilfe anzeigen");
    out.println("/id                -> eigene Node-ID");
    out.println("/ttl <1..15>       -> maxHops ");
    out.println("/scan              -> Stationen suchen");
    out.println("/stations          -> gefundene Stationen anzeigen");
    out.println("/wx on|off|status  -> Weather-Mode steuern");
    out.println("/wxreq [all|node]  -> Wetterdaten anfragen");
    out.println("/mykey gen|show    -> eigener Key fuer eigene Node-ID");
    out.println("/key set <id> <hex32> -> Key fuer fremde Node-ID speichern");
    out.println("/key del <id>      -> Key fuer Node-ID loeschen");
    out.println("/keys              -> gespeicherte Keys anzeigen");
    out.println("/eto <id> <text>   -> verschluesselte Direktnachricht");
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
        out.print(LORA_POWER);
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
            out.print("maxHops gesetzt auf ");
            out.println(configuredMaxHops);
        }
        else
        {
            out.println("Ungueltiger Wert. Erlaubt: 1..15");
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
        out.println("Weather-Mode: ON");
        return;
    }

    if (line == "/wx off")
    {
        weatherModeEnabled = false;
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
        out.println("Eigener Key neu generiert.");
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
            out.print("Key geloescht fuer Node 0x");
            out.println(keyNode, HEX);
        }
        else
        {
            out.println("Kein Key fuer diese Node vorhanden.");
        }
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
    delay(400);

    uint64_t mac = ESP.getEfuseMac();
    nodeId = static_cast<uint16_t>(mac & 0xFFFF);
    randomSeed(static_cast<unsigned long>(micros()) ^ static_cast<unsigned long>(nodeId));

    SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_NSS);

    int16_t state = radio.begin(
        LORA_FREQUENCY,
        LORA_BANDWIDTH,
        LORA_SF,
        LORA_CR,
        LORA_SYNC_WORD,
        LORA_POWER,
        LORA_PREAMBLE,
        LORA_TCXO_VOLTAGE,
        false);

    if (state != RADIOLIB_ERR_NONE)
    {
        out.print("LoRa init Fehler: ");
        out.println(state);
        while (true)
        {
            delay(1000);
        }
    }

    radio.setDio1Action(setRadioFlag);

    restartReceive();

    BLEDevice::init("MegaMesh");
    BLEServer *pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MeshBLEServerCB());
    BLEService *pSvc = pServer->createService("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    pTxChar = pSvc->createCharacteristic("6E400003-B5A3-F393-E0A9-E50E24DCCA9E", BLECharacteristic::PROPERTY_NOTIFY);
    pTxChar->addDescriptor(new BLE2902());
    BLECharacteristic *pRxChar = pSvc->createCharacteristic("6E400002-B5A3-F393-E0A9-E50E24DCCA9E", BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    pRxChar->setCallbacks(new MeshBLERxCB());
    pSvc->start();
    BLEDevice::startAdvertising();

    out.println("Mesh gestartet ");
    out.print("Node ID: 0x");
    out.println(nodeId, HEX);
    out.println("Weather-Mode: OFF");
    out.println("Encryption: /mykey gen for eigenen Node-Key");
    out.println("BLE: MegaMesh (NUS)");
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

    if (bleCmdReady)
    {
        handleSerialLine(blePendingCmd);
        bleCmdReady = false;
    }

    if (radioIrq)
    {
        radioIrq = false;
        handleReceivedPacket();
    }
}
