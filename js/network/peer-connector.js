import EventEmitter from '../utils/event-emmiter.js';
import { messageType, timeoutConnection } from '../data/settings.js';
import { webSocketEvents } from '../network/websocket.js';
import { createMessage } from '../helpers/helpers.js';

export const peerConnectorEvents = {
  DATA_CHANNEL: `dataChannel`,
  CONNECTION_STATE_CHANGE: `connectionStateChange`,
  ICE_CANDIDATE: `iceCandidate`,
  ICE_CONNECTION_STATE_CHANGE: `iceConnectionStateChange`,
  OPEN_DATA_CHANNEL: `openDataChannel`,
  MESSAGE_DATA_CHANNEL: `messageDataChannel`,
  CLOSE_DATA_CHANNEL: `closeDataChannel`,
};

// TODO как то убрать
let resolveFn;
const promise = new Promise((resolve) => {
  resolveFn = resolve;
});
//

class PeerConnector extends EventEmitter {
  #channel = null;
  #localIceCondidateList = [];
  #peerConnection = null;
  #iniciatorId = null;
  #recipientId = null;
  #connectionTimeout = null;

  constructor(socket, isIniciator, nameDataChannel = `gomoku`) {
    super();
    this.nameDataChannel = nameDataChannel;
    this.isIniciator = isIniciator;
    this.socket = socket;
    this.socket.subscribe(webSocketEvents.MESSAGE, this.onSocketMessage);
  }

  get dataChannel() {
    return this.#channel;
  }

  get iniciatorId() {
    return this.#iniciatorId;
  }

  set iniciatorId(id) {
    this.#iniciatorId = id;
  }

  get recipientId() {
    return this.#recipientId;
  }

  set recipientId(id) {
    this.#recipientId = id;
  }

  get iceCandidateList() {
    return this.#localIceCondidateList;
  }

  create() {
    this.#peerConnection = new RTCPeerConnection();
    this.#peerConnection.addEventListener(`datachannel`, this.onDataChannel);
    this.#peerConnection.addEventListener(
      `connectionstatechange`,
      this.onConnectionStateChange
    );
    this.#peerConnection.addEventListener(`icecandidate`, this.onIceCandidate);
    this.#peerConnection.addEventListener(
      `iceconnectionstatechange`,
      this.onIceConnectionStateChange
    );
  }

  close() {
    if (this.#peerConnection.connectionState === `connected`) {
      this.#peerConnection.close();
    }
  }

  addIceCandidate(candidate) {
    this.#peerConnection.addIceCandidate(candidate);
  }

  onDataChannel = (e) => {
    this.#channel = e.channel;
    // использую on т.к. onDataChannel вызывается у recipient`a
    this.#channel.onopen = this.onOpenDataChannel;
    this.#channel.onclose = this.onCloseDataChannel;
    this.#channel.onmessage = this.onMessageDataChannel;
    this.emit(peerConnectorEvents.DATA_CHANNEL, e);
  };

  onOpenDataChannel = () => {
    this.clearConnectionTimeout();
    this.emit(peerConnectorEvents.OPEN_DATA_CHANNEL);
  };

  onCloseDataChannel = () => {
    this.emit(peerConnectorEvents.CLOSE_DATA_CHANNEL);
  };

  onMessageDataChannel = (e) => {
    // try {
    const message = JSON.parse(e.data);
    this.emit(peerConnectorEvents.MESSAGE_DATA_CHANNEL, message);
    // } catch(error) {
    //     throw new Error(error);
    // }
  };

  sendData(data) {
    // try {
    const message = JSON.stringify(data);
    this.#channel.send(message);
    // } catch(error) {
    //     throw new Error(error);
    // }
  }

  createDataChannel(name) {
    this.#channel = this.#peerConnection.createDataChannel(name);
    // использую on т.к. createDataChannel вызывается у iniciator`a
    this.#channel.onopen = this.onOpenDataChannel;
    this.#channel.onclose = this.onCloseDataChannel;
    this.#channel.onmessage = this.onMessageDataChannel;
  }

  async createOffer() {
    this.createDataChannel(this.nameDataChannel);
    const offer = await this.#peerConnection.createOffer();
    await this.#peerConnection.setLocalDescription(offer);
    return offer;
  }

  async createAnswer() {
    const answer = await this.#peerConnection.createAnswer();
    await this.#peerConnection.setLocalDescription(answer);
    return answer;
  }

  onConnectionStateChange = (e) => {
    if (this.#peerConnection.connectionState === `connected`) {
      this.socket.close();
    }
    this.emit(
      peerConnectorEvents.CONNECTION_STATE_CHANGE,
      this.#peerConnection.connectionState
    );
  };

  onIceConnectionStateChange = (e) => {
    this.emit(
      peerConnectorEvents.ICE_CONNECTION_STATE_CHANGE,
      this.#peerConnection.iceConnectionState
    );
  };

  onIceCandidate = (event) => {
    if (event.candidate) {
      this.#localIceCondidateList.push(event.candidate);
    } else {
      this.clearConnectionTimeout();
      resolveFn();
    }
    this.emit(peerConnectorEvents.ICE_CANDIDATE, event.candidate);
  };

  sendIceCandidates() {
    const message = createMessage(messageType.ICE_CANDIDATE, {
      clientId: this.isIniciator ? this.recipientId : this.iniciatorId,
      iceCondidateList: this.#localIceCondidateList,
    });

    this.socket.send(message);
  }

  async acceptRemoteOffer(offer) {
    return await this.#peerConnection.setRemoteDescription(offer);
  }

  async acceptAnswer(answer) {
    return await this.#peerConnection.setRemoteDescription(answer);
  }

  onSocketMessage = async (message) => {
    switch (message.type) {
      case messageType.INIT_USER:
        const clientId = message.payload.clientId;
        if (this.isIniciator) {
          this.iniciatorId = clientId;
          const offer = await this.createOffer();
          const responseMessage = createMessage(messageType.OFFER, {
            offer,
            iniciatorId: this.iniciatorId,
          });

          this.socket.send(responseMessage);
          this.setConnectionTimeout();
        } else {
          this.recipientId = clientId;
          const responseMessage = createMessage(messageType.FIND_GAME);
          this.socket.send(responseMessage);
          this.setConnectionTimeout();
        }
        break;

      case messageType.ICE_CANDIDATE:
        console.log(`ice condidate`);
        this.clearConnectionTimeout();
        message.payload.iceCondidateList.forEach((candidate) => {
          this.addIceCandidate(candidate);
        });
        break;

      case messageType.OFFER:
        this.iniciatorId = message.payload.iniciatorId;
        this.acceptRemoteOffer(message.payload.offer).then(() => {
          this.createAnswer().then((answer) => {
            const responseMessage = createMessage(messageType.ANSWER, {
              iniciatorId: this.iniciatorId,
              recipientId: this.recipientId,
              answer,
            });

            this.socket.send(responseMessage);
            this.setConnectionTimeout();
          });
        });
        break;

      case messageType.ANSWER:
        this.recipientId = message.payload.recipientId;
        console.log(`send answer`);

        this.acceptAnswer(message.payload.answer).then(() => {
          promise.then(() => {
            this.clearConnectionTimeout();
            this.setConnectionTimeout();
            this.sendIceCandidates();
          });
        });
        break;
    }
  };

  setConnectionTimeout = () => {
    if (this.#connectionTimeout == null) {
      this.#connectionTimeout = setTimeout(() => {
        this.socket.close(false);
      }, timeoutConnection);
    }
  };

  clearConnectionTimeout = () => {
    if (this.#connectionTimeout) {
      clearTimeout(this.#connectionTimeout);
      this.#connectionTimeout = null;
    }
  };
}

export default PeerConnector;
