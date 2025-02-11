import EventDispatcher from "./EventDispatcher.js";
import { Poll, Logger, sendBackgroundMessage, addBackgroundListener } from "./utils.js";
import UKDiscoveredDevice from "./UKDiscoveredDevice.js";

class UKBluetoothManager {
    logger = new Logger(false, this);
    eventDispatcher = new EventDispatcher();

    static #shared = new UKBluetoothManager();
    static get shared() {
        return this.#shared;
    }

    #isScanning = false;
    get isScanning() {
        return this.#isScanning;
    }
    /** @param {boolean} newValue */
    #updateIsScanning(newValue) {
        if (this.#isScanning != newValue) {
            this.#isScanning = newValue;
            this.logger.log("stopping isScanningPoll");
            this.#isScanningPoll.stop();

            this.logger.log(`updated isScanning to ${this.isScanning}`);
            this.eventDispatcher.dispatchEvent({
                type: "isScanning",
                message: { isScanning: this.isScanning },
            });

            if (this.isScanning) {
                this.logger.log("starting discoveredDevicesPoll");
                this.#discoveredDevicesPoll.start();
            } else {
                this.logger.log("stopping discoveredDevicesPoll");
                this.#discoveredDevicesPoll.stop();
            }
        }
    }

    /**
     * @param {object} message
     * @param {string} message.type
     */
    async #sendBackgroundMessage(message) {
        return sendBackgroundMessage(message);
    }

    async checkIsScanning() {
        const response = await this.#sendBackgroundMessage({ type: "isScanning" });
        const { isScanning } = response;
        this.logger.log(`isScanning response: ${isScanning}`, response);
        this.#updateIsScanning(isScanning);
    }

    #isScanningPoll = new Poll(this.checkIsScanning.bind(this), 100);

    async setScan(newValue) {
        if (newValue != this.isScanning) {
            this.logger.log("starting isScanningPoll");
            this.#isScanningPoll.start();
            await this.#sendBackgroundMessage({ type: "setScan", newValue });
        } else {
            this.logger.log("redundant setScan");
        }
    }
    async toggleScan() {
        return this.setScan(!this.isScanning);
    }

    #discoveredDevicesPoll = new Poll(this.checkDiscoveredDevices.bind(this), 200);
    async checkDiscoveredDevices() {
        const response = await this.#sendBackgroundMessage({ type: "discoveredDevices" });
        const { discoveredDevices: discoveredDevicesInfo } = response;
        this.logger.log(`discovered ${discoveredDevicesInfo.length} devices`, response);
        this.#updateDiscoveredDevices(discoveredDevicesInfo);
    }

    /** @type {Object.<string, UKDiscoveredDevice>} */
    #discoveredDevices = {};
    get discoveredDevices() {
        return this.#discoveredDevices;
    }

    /**
     * @typedef {import('./UKDiscoveredDevice.js').UKDiscoveredDeviceInfo} UKDiscoveredDeviceInfo
     */

    /**
     *
     * @param {[UKDiscoveredDeviceInfo]} discoveredDevicesInfo
     */
    #updateDiscoveredDevices(discoveredDevicesInfo) {
        const idsToDelete = new Set();
        for (const id in this.#discoveredDevices) {
            if (!this.#discoveredDevices[id].isConnected) {
                idsToDelete.add(id);
            }
        }
        discoveredDevicesInfo.forEach((discoveredDeviceInfo) => {
            const { id } = discoveredDeviceInfo;

            if (idsToDelete.has(id)) {
                idsToDelete.delete(id);
            }

            if (this.#discoveredDevices[id]) {
                const discoveredDevice = this.#discoveredDevices[id];
                this.logger.log(`updating ${id}`, discoveredDevice);
                discoveredDevice.update(discoveredDeviceInfo);
            } else {
                const discoveredDevice = new UKDiscoveredDevice(discoveredDeviceInfo);
                this.logger.log(`creating ${id}`, discoveredDevice);
                this.#discoveredDevices[id] = discoveredDevice;
                this.eventDispatcher.dispatchEvent({
                    type: "discoveredDeviceAdded",
                    message: { discoveredDevice },
                });
            }
        });

        idsToDelete.forEach((id) => {
            const discoveredDevice = this.#discoveredDevices[id];
            this.logger.log(`destroying ${id}`, discoveredDevice);
            discoveredDevice.destroy();
            delete this.#discoveredDevices[id];
            this.eventDispatcher.dispatchEvent({
                type: "discoveredDeviceRemoved",
                message: { discoveredDevice },
            });
        });

        this.eventDispatcher.dispatchEvent({
            type: "discoveredDevices",
            message: { discoveredDevices: this.discoveredDevices },
        });
    }

    /** @type {[UKMission]} */
    devices = [];

    /** UKBluetoothManager is a singleton - use UKBluetoothManager.shared */
    constructor() {
        if (this.shared) {
            throw new Error("UKBluetoothManager is a singleton - use UKBluetoothManager.shared");
        }

        window.addEventListener("unload", () => {
            this.setScan(false);
        });

        addBackgroundListener(this.#onBackgroundMessage.bind(this));

        window.addEventListener("load", () => {
            this.checkIsScanning();
            this.checkDiscoveredDevices();
        });
    }

    /**
     * @param {object} message
     * @param {string} message.type
     */
    #onBackgroundMessage(message) {
        this.logger.log(`received background message of type ${message.type}`, message);

        switch (message.type) {
            case "isScanning":
                this.#updateIsScanning(message.isScanning);
                break;
            case "discoveredDevices":
                this.#updateDiscoveredDevices(message.discoveredDevices);
                break;
            default:
                //this.logger.log(`uncaught message type ${message.type}`);
                break;
        }
    }
}

export default UKBluetoothManager.shared;
