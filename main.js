const notes = {
  C1: 32.7,
  "C#1/Db1": 34.65,
  D1: 36.71,
  "D#1/Eb1": 38.89,
  E1: 41.2,
  F1: 43.65,
  "F#1/Gb1": 46.25,
  G1: 49.0,
  "G#1/Ab1": 51.91,
  A1: 55.0,
  "A#1/Bb1": 58.27,
  B1: 61.74,
  C2: 65.41,
  "C#2/Db2": 69.3,
  D2: 73.42,
  "D#2/Eb2": 77.78,
  E2: 82.41,
  F2: 87.31,
  "F#2/Gb2": 92.5,
  G2: 98.0,
  "G#2/Ab2": 103.83,
  A2: 110.0,
  "A#2/Bb2": 116.54,
  B2: 123.47,
  C3: 130.81,
  "C#3/Db3": 138.59,
  D3: 146.83,
  "D#3/Eb3": 155.56,
  E3: 164.81,
  F3: 174.61,
  "F#3/Gb3": 185.0,
  G3: 196.0,
  "G#3/Ab3": 207.65,
  A3: 220.0,
  "A#3/Bb3": 233.08,
  B3: 246.94,
  C4: 261.63,
  "C#4/Db4": 277.18,
  D4: 293.66,
  "D#4/Eb4": 311.13,
  E4: 329.63,
  F4: 349.23,
  "F#4/Gb4": 369.99,
  G4: 392.0,
  "G#4/Ab4": 415.3,
  A4: 440.0,
  "A#4/Bb4": 466.16,
  B4: 493.88,
  C5: 523.25,
  "C#5/Db5": 554.37,
  D5: 587.33,
  "D#5/Eb5": 622.25,
  E5: 659.26,
  F5: 698.46,
  "F#5/Gb5": 739.99,
  G5: 783.99,
  "G#5/Ab5": 830.61,
  A5: 880.0,
  "A#5/Bb5": 932.33,
  B5: 987.77,
  C6: 1046.5,
  "C#6/Db6": 1108.73,
  D6: 1174.66,
  "D#6/Eb6": 1244.51,
  E6: 1318.51,
  F6: 1396.91,
  "F#6/Gb6": 1479.98,
  G6: 1567.98,
  "G#6/Ab6": 1661.22,
  A6: 1760.0,
  "A#6/Bb6": 1864.66,
  B6: 1975.53,
  C7: 2093.0,
};

class EventBus {
  constructor() {
    this.events = {};
  }

  subscribe(event, callback) {
    if (!this.events.hasOwnProperty(event)) {
      this.events[event] = [];
    }

    this.events[event].push(callback);
  }

  publish(event, data = {}) {
    if (!this.events.hasOwnProperty(event)) {
      return;
    }

    return this.events[event].map((callback) => callback(data));
  }
}

class StateManager {
  constructor() {
    let self = this;
    self.eventBus = new EventBus();
    self.state = new Proxy(
      {},
      {
        set: function (state, key, value) {
          state[key] = value;
          self.eventBus.publish(`${key}Changed`, value);
          return true;
        },
      }
    );
    self.actions = {
      init: (state) => {
        state.volume = 0.1;
        state.bpm = 120;
      },
      setBpm: (state, value) => (state.bpm = value),
      setVolume: (state, value) => (state.volume = value),
    };
  }

  dispatch(actionKey, payload) {
    let self = this;
    if (typeof self.actions[actionKey] !== "function") {
      console.warn(`Action ${actionKey} doesn't exist`);
      return;
    }

    self.status = "action";
    self.actions[actionKey](self.state, payload);
  }
}

class Sequencer {
  constructor() {
    this.audioCtx = new AudioContext();
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.connect(this.audioCtx.destination);

    this.isPlaying = false;
    this.timerId = undefined;
    this.currentBeatNumber = 0;
    this.shouldPlayCurrentBeatAt = 0.0;
    this.totalBeats = 32;
    this.notesByBeat = [];

    for (var i = 0; i < this.totalBeats; i++) {
      this.notesByBeat[i] = [];
    }

    this.lookahead = 25.0; // How frequently to call scheduling function (in milliseconds)
    this.scheduleAheadTime = 0.1; // How far ahead to schedule audio (sec)

    this.bpm = undefined;

    this.lastBeatDrawn = undefined;
    this.drawBeatQueue = [];
  }

  play() {
    this.isPlaying = !this.isPlaying;

    if (this.isPlaying) {
      if (this.audioCtx.state === "suspended") {
        this.audioCtx.resume();
      }

      this.currentBeatNumber = 0;
      this.shouldPlayCurrentBeatAt = this.audioCtx.currentTime;
      this.beatScheduler();
      this.drawScheduler();
    } else {
      clearTimeout(this.timerId);
    }
  }

  beatScheduler() {
    while (
      this.shouldPlayCurrentBeatAt <
      this.audioCtx.currentTime + this.scheduleAheadTime
    ) {
      this.scheduleBeat(this.currentBeatNumber, this.shouldPlayCurrentBeatAt);
      this.nextBeat();
    }
    this.timerId = setTimeout(() => {
      this.beatScheduler();
    }, this.lookahead);
  }

  scheduleBeat(beatNumber, time) {
    this.drawBeatQueue.push({ beatNumber: beatNumber, time: time });
    for (var note of this.notesByBeat[beatNumber]) {
      this.playNote(time, note);
    }
  }

  nextBeat() {
    this.currentBeatNumber = (this.currentBeatNumber + 1) % this.totalBeats;

    const secondsPerBeat = 60.0 / (this.bpm * 4);
    this.shouldPlayCurrentBeatAt += secondsPerBeat;
  }

  drawScheduler() {
    requestAnimationFrame(() => {
      this.draw();
    });
  }

  // TODO Chech if should be refactored (naming, direct references, etc)
  draw() {
    if (!this.isPlaying) {
      return;
    }

    let drawBeat = this.lastBeatDrawn;
    const currentTime = this.audioCtx.currentTime;

    while (
      this.drawBeatQueue.length &&
      this.drawBeatQueue[0].time < currentTime
    ) {
      drawBeat = this.drawBeatQueue[0].beatNumber;
      this.drawBeatQueue.shift();
    }

    if (this.lastBeatDrawn !== drawBeat) {
      pianoCanvas.drawBeat(drawBeat);
      this.lastBeatDrawn = drawBeat;
    }

    requestAnimationFrame(() => {
      this.draw();
    });
  }

  playNote(time, note) {
    const osc = new OscillatorNode(this.audioCtx, {
      frequency: notes[note],
      type: "sawtooth",
    });

    osc.connect(this.gainNode);
    osc.start(time);
    osc.stop(time + 0.1);
  }

  setVolume(volume) {
    this.gainNode.gain.value = volume;
  }

  setBpm(bpm) {
    this.bpm = bpm;
  }

  isEnabled(beat, note) {
    return this.notesByBeat[beat].includes(note);
  }

  toggleNote(beat, note) {
    if (this.isEnabled(beat, note)) {
      this.removeNote(beat, note);
    } else {
      this.addNote(beat, note);
    }
  }

  addNote(beat, note) {
    this.notesByBeat[beat].push(note);
    stateManager.eventBus.publish("noteAdded", { beat: beat, note: note });
  }

  removeNote(beat, note) {
    const index = this.notesByBeat[beat].indexOf(note);
    this.notesByBeat[beat].splice(index, 1);

    stateManager.eventBus.publish("noteRemoved", { beat: beat, note: note });
  }
}

// ================================================================================
const stateManager = new StateManager();

const sequencer = new Sequencer();
stateManager.eventBus.subscribe("bpmChanged", (value) => {
  sequencer.setBpm(value);
});
stateManager.eventBus.subscribe("volumeChanged", (value) =>
  sequencer.setVolume(value)
);

const volumeControl = document.querySelector("#volume");
volumeControl.value = stateManager.state.volume;
volumeControl.addEventListener(
  "input",
  (ev) => stateManager.dispatch("setVolume", ev.target.value),
  false
);

const bpmControl = document.querySelector("#bpm");
bpmControl.value = stateManager.state.bpm;
bpmControl.addEventListener(
  "input",
  (ev) => stateManager.dispatch("setBpm", ev.target.value),
  false
);

const bpmValue = document.querySelector("#bpmValue");
stateManager.eventBus.subscribe(
  "bpmChanged",
  (value) => (bpmValue.innerHTML = value)
);

// ================================================================================
document
  .querySelector("#play")
  .addEventListener("click", () => sequencer.play());

stateManager.dispatch("init");

// ================================================================================

class CanvasLayer {
  constructor(id, totalRows, totalColumns) {
    this.cellHeight = 30;
    this.cellWidth = 40;

    this.keyCellWidth = this.cellWidth * 2;

    this.totalRows = totalRows;
    this.totalColumns = totalColumns;

    let width = this.keyCellWidth + this.totalColumns * this.cellWidth;
    let height = this.totalRows * this.cellHeight;

    let canvas = document.getElementById(id);
    canvas.width = width;
    canvas.height = height;

    this.canvas = canvas;
    this.canvasCtx = canvas.getContext("2d");
  }

  getCellX(columnIndex) {
    return this.keyCellWidth + columnIndex * this.cellWidth;
  }

  getCellY(rowIndex) {
    return rowIndex * this.cellHeight;
  }

  drawCell(x, y, color) {
    this.canvasCtx.beginPath();
    this.canvasCtx.fillStyle = color;
    this.canvasCtx.strokeStyle = "rgb(24,24,24)";
    this.canvasCtx.rect(x, y, this.cellWidth, this.cellHeight);
    this.canvasCtx.fill();
    this.canvasCtx.stroke();
  }
}

class BaseCanvasLayer extends CanvasLayer {
  constructor(totalRows, totalColumns) {
    super("base", totalRows, totalColumns);
  }

  draw() {
    for (let i = 0; i < this.totalRows; i++) {
      let y = i * this.cellHeight;

      this.canvasCtx.beginPath();
      this.canvasCtx.fillStyle = "rgb(60,60,60)";
      this.canvasCtx.strokeStyle = "rgb(24,24,24)";
      this.canvasCtx.rect(0, y, this.keyCellWidth, this.cellHeight);
      this.canvasCtx.fill();
      this.canvasCtx.stroke();

      this.canvasCtx.font = "16px Georgia";
      this.canvasCtx.textAlign = "center";
      this.canvasCtx.textBaseline = "middle";

      this.canvasCtx.fillStyle = "#FFFFFF";
      this.canvasCtx.fillText(
        Object.keys(notes)[i],
        0 + this.keyCellWidth / 2,
        y + this.cellHeight / 2
      );

      for (let j = 0; j < this.totalColumns; j++) {
        let x = this.getCellX(j);
        let color = j % 4 === 0 ? "rgb(35,35,35)" : "rgb(40,40,40)";
        this.drawCell(x, y, color);
      }
    }
  }
}

class NoteCanvasLayer extends CanvasLayer {
  constructor(totalRows, totalColumns, onClickNote) {
    super("note", totalRows, totalColumns);

    this.onClickNote = onClickNote;

    //TODO check if it's correct math
    this.canvasLeft =
      this.canvas.offsetParent.offsetLeft + this.canvas.clientLeft;
    this.canvasTop = this.canvas.offsetParent.offsetTop + this.canvas.clientTop;

    this.canvas.addEventListener("click", (ev) => this.onClick(ev));
  }

  onClick(ev) {
    let x = ev.pageX - this.canvasLeft;
    let y = ev.pageY - this.canvasTop;

    let beatNumber = Math.floor((x - this.keyCellWidth) / this.cellWidth);
    let noteIndex = Math.floor(y / this.cellHeight);
    let note = Object.keys(notes)[noteIndex];

    console.log("Beat number", beatNumber);
    console.log("Note Index", noteIndex);
    console.log("Note", note);

    this.onClickNote(beatNumber, note);
  }

  drawNote(beat, note) {
    let x = this.getCellX(beat);
    let y = this.getCellY(Object.keys(notes).indexOf(note));

    console.log("should draw", beat, note, x, y);
    this.drawCell(x, y, "gray");
  }

  clearNote(beat, note) {
    let x = this.getCellX(beat);
    let y = this.getCellY(Object.keys(notes).indexOf(note));

    this.canvasCtx.clearRect(x, y, this.cellWidth, this.cellHeight);
  }
}

class BeatCanvasLayer extends CanvasLayer {
  constructor(totalRows, totalColumns) {
    super("beat", totalRows, totalColumns);
    this.lastDrawnBeat = undefined;
  }

  drawBeat(beat) {
    this.clearLastDrawnBeat();

    let x = this.getCellX(beat);
    for (let i = 0; i < this.totalRows; i++) {
      let y = this.getCellY(i);
      this.drawCell(x, y, "aquamarine");
    }

    this.lastDrawnBeat = beat;
  }

  clearLastDrawnBeat() {
    if (this.lastDrawnBeat === undefined) {
      return;
    }
    let x = this.getCellX(this.lastDrawnBeat);
    this.canvasCtx.clearRect(x, 0, this.cellWidth, this.canvas.height);

    this.lastDrawnBeat = undefined;
  }
}

class PianoCanvas {
  constructor(totalBeats) {
    let totalRows = Object.keys(notes).length;
    let totalColumns = totalBeats;

    this.baseLayer = new BaseCanvasLayer(totalRows, totalColumns);
    this.noteLayer = new NoteCanvasLayer(
      totalRows,
      totalColumns,
      (beat, note) => sequencer.toggleNote(beat, note)
    );
    this.beatLayer = new BeatCanvasLayer(totalRows, totalColumns);

    stateManager.eventBus.subscribe("noteAdded", (ev) =>
      this.noteLayer.drawNote(ev.beat, ev.note)
    );
    stateManager.eventBus.subscribe("noteRemoved", (ev) =>
      this.noteLayer.clearNote(ev.beat, ev.note)
    );

    this.baseLayer.draw();
  }

  drawBeat(beat) {
    this.beatLayer.drawBeat(beat);
  }
}

// TODO Draw labels as piano keys
// TODO Get rid of direct references to sequencer from canvas methods

const pianoCanvas = new PianoCanvas(sequencer.totalBeats);
