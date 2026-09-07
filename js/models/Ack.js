// Ack.js — acknowledgement model. GBN uses cumulative ACKs:
// "ACK n" means "I have correctly received everything up to and including n".

export class Ack {
  constructor(ackNum, { duplicate = false } = {}) {
    this.ackNum = ackNum;
    this.duplicate = duplicate;
  }
}
