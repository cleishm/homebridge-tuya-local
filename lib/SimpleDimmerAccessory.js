const BaseAccessory = require('./BaseAccessory');

class SimpleDimmerAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.LIGHTBULB;
    }

    constructor(...props) {
        super(...props);
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;

        this.accessory.addService(Service.Lightbulb, this.device.context.name);

        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;
        const service = this.accessory.getService(Service.Lightbulb);
        this._checkServiceName(service, this.device.context.name);

        this.dpPower = this._getCustomDP(this.device.context.dpPower) || '1';
        this.dpBrightness = this._getCustomDP(this.device.context.dpBrightness) || this._getCustomDP(this.device.context.dp) || '2';

        const characteristicOn = service.getCharacteristic(Characteristic.On)
            .updateValue(dps[this.dpPower])
            .on('get', this.getState.bind(this, this.dpPower))
            .on('set', this.setPower.bind(this));

        const characteristicBrightness = service.getCharacteristic(Characteristic.Brightness)
            .updateValue(this.convertBrightnessFromTuyaToHomeKit(dps[this.dpBrightness]))
            .on('get', this.getBrightness.bind(this))
            .on('set', this.setBrightness.bind(this));

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpPower)) {
                // A power change we did not just write ourselves came from
                // somewhere else: another bridge, the vendor app on the LAN, or
                // an on-device schedule. The full state is logged because the
                // mode/scene datapoints identify which.
                if (!this._isLocalWrite()) this.log.info(`${this._logName()} switched ${changes[this.dpPower] ? 'ON' : 'OFF'} externally — state ${JSON.stringify(state)}`);
                if (characteristicOn.value !== changes[this.dpPower]) characteristicOn.updateValue(changes[this.dpPower]);
            }
            if (changes.hasOwnProperty(this.dpBrightness) && this.convertBrightnessFromHomeKitToTuya(characteristicBrightness.value) !== changes[this.dpBrightness])
                characteristicBrightness.updateValue(this.convertBrightnessFromTuyaToHomeKit(changes[this.dpBrightness]));
        });
    }

    _isLocalWrite() {
        return this._writtenAt != null && Date.now() - this._writtenAt < 5000;
    }

    setPower(value, callback, context, connection) {
        this._writtenAt = Date.now();
        this.log.info(`${this._logName()} switched ${value ? 'ON' : 'OFF'} by ${this._describeConnection(connection)}`);

        const dps = {[this.dpPower]: value};
        // powerOnDps: extra datapoints asserted on every power-on, so devices
        // exposed with reduced controls always return to a known mode (e.g.
        // {"21": "white", "23": 0} for warm white). Already-correct values are
        // skipped by setMultiState.
        if (value && this.device.context.powerOnDps) Object.assign(dps, this.device.context.powerOnDps);
        this.setMultiState(dps, callback);
    }

    getBrightness(callback) {
        callback(null, this.convertBrightnessFromTuyaToHomeKit(this.device.state[this.dpBrightness]));
    }

    setBrightness(value, callback) {
        this._writtenAt = Date.now();
        this.setState(this.dpBrightness, this.convertBrightnessFromHomeKitToTuya(value), callback);
    }
}

module.exports = SimpleDimmerAccessory;