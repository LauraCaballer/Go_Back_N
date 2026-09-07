// Packet.js — data packet model and its possible states.

export const PacketStatus = Object.freeze({
  WAITING: 'waiting',           // not sent yet
  SENT: 'sent',                 // just handed to the channel
  IN_TRANSIT: 'in_transit',     // travelling across the channel
  RECEIVED: 'received',         // arrived and accepted in order
  ACKED: 'acked',               // cumulative ACK has confirmed it
  LOST: 'lost',                 // dropped in the channel, never arrived
  OUT_OF_ORDER: 'out_of_order', // arrived but discarded by the receiver
  RETRANSMITTED: 'retransmitted' // sent again after a timeout
});

export class Packet {
  constructor(seq) {
    this.seq = seq;
    this.status = PacketStatus.WAITING;
    this.attempts = 0;
    this.ackReceived = false;
    this.lastChannelItemId = null;
  }

  markSent() {
    this.attempts += 1;
    this.status = this.attempts > 1 ? PacketStatus.RETRANSMITTED : PacketStatus.SENT;
  }

  markInTransit() {
    this.status = PacketStatus.IN_TRANSIT;
  }

  markReceived() {
    this.status = PacketStatus.RECEIVED;
  }

  markAcked() {
    this.status = PacketStatus.ACKED;
    this.ackReceived = true;
  }

  markLost() {
    this.status = PacketStatus.LOST;
  }

  markOutOfOrder() {
    this.status = PacketStatus.OUT_OF_ORDER;
  }

  reset() {
    this.status = PacketStatus.WAITING;
    this.attempts = 0;
    this.ackReceived = false;
    this.lastChannelItemId = null;
  }
}
