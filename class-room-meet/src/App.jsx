

import { useState, useRef, useEffect } from 'react';

function App() {
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const localVideoRef = useRef(null);
  const peersRef = useRef({});
  const localStreamRef = useRef(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const socketRef = useRef(null);

  const handleJoin = () => {
    if (!roomId) return alert('Enter room ID');
    setJoined(true);
  };

  useEffect(() => {
    if (!joined) return;

    const socket = new WebSocket('wss://video.markmarketing.xyz/ws');
    socketRef.current = socket;

    let localStream;

    (async () => {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = localStream;
      localVideoRef.current.srcObject = localStream;

      socket.send(JSON.stringify({ type: "join", room: roomId }));

      socket.onmessage = async ({ data }) => {
        const msg = JSON.parse(data);

        if (msg.type === "new-peer") {
          const peerId = msg.id;
          const peer = createPeer(peerId, socket, localStream);
          peersRef.current[peerId] = peer;
        }

        if (msg.type === "signal") {
          const { from, data: signal } = msg;
          let peer = peersRef.current[from];

          if (!peer) {
            peer = createPeer(from, socket, localStream);
            peersRef.current[from] = peer;
          }

          if (signal.type === "offer") {
            await peer.setRemoteDescription(new RTCSessionDescription(signal));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            socket.send(JSON.stringify({ type: "signal", to: from, data: peer.localDescription }));
          } else if (signal.type === "answer") {
            await peer.setRemoteDescription(new RTCSessionDescription(signal));
          } else if (signal.candidate) {
            await peer.addIceCandidate(new RTCIceCandidate(signal));
          }
        }
      };
    })();

    return () => {
      socket.close();
      Object.values(peersRef.current).forEach(peer => peer.close());
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [joined, roomId]);

  function createPeer(peerId, socket, localStream) {
    const peer = new RTCPeerConnection();
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

    peer.onicecandidate = (e) => {
      if (e.candidate) {
        socket.send(JSON.stringify({ type: "signal", to: peerId, data: e.candidate }));
      }
    };

    peer.ontrack = ({ streams }) => {
      setRemoteStreams(prev => ({ ...prev, [peerId]: streams[0] }));
    };

    peer.createOffer().then(offer => {
      peer.setLocalDescription(offer);
      socket.send(JSON.stringify({ type: "signal", to: peerId, data: offer }));
    });

    return peer;
  }

  return (
    <div>
      {!joined ? (
        <div>
          <input
            placeholder="Room ID"
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
          />
          <button onClick={handleJoin}>Join Room</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <video ref={localVideoRef} autoPlay muted width={300} />
          {Object.entries(remoteStreams).map(([peerId, stream]) => (
            <video
              key={peerId}
              autoPlay
              width={300}
              ref={el => { if (el) el.srcObject = stream; }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
