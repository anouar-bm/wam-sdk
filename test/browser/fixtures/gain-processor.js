// AudioWorklet side of the test fixture WAM: output = input * gain.
// A MIDI note-on also adds note/128 to the output at the event's sample,
// so event timing can be checked in the rendered audio.
// Loaded with audioWorklet.addModule() after WamNode.addModules() has
// registered the SDK classes in this module's scope.
const moduleId = 'com.wam-sdk-test.gain';

const { registerProcessor, webAudioModules } = globalThis;
const { WamProcessor, WamParameterInfo } = webAudioModules.getModuleScope(moduleId);

class GainProcessor extends WamProcessor {
	constructor(options) {
		super(options);
		this._marker = 0;
	}

	_generateWamParameterInfo() {
		return {
			gain: new WamParameterInfo('gain', { type: 'float', label: 'Gain', defaultValue: 0.5, minValue: 0, maxValue: 1 }),
		};
	}

	_onMidi(midiData) {
		const [status, note] = midiData.bytes;
		if ((status & 0xf0) === 0x90) this._marker += note / 128;
	}

	_process(startSample, endSample, inputs, outputs) {
		const input = inputs[0];
		const output = outputs[0];
		const gain = this._parameterState.gain.value;
		for (let channel = 0; channel < output.length; channel++) {
			const inChannel = input[channel];
			const outChannel = output[channel];
			for (let i = startSample; i < endSample; i++) {
				outChannel[i] = inChannel ? inChannel[i] * gain : 0;
			}
			if (startSample < endSample) outChannel[startSample] += this._marker;
		}
		if (startSample < endSample) this._marker = 0;
	}
}

registerProcessor(moduleId, GainProcessor);
