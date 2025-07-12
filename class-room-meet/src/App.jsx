

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

    socket.onopen = () => {
      console.log('WebSocket connection established');
    };

    socket.onclose = (event) => {
      console.log('WebSocket connection closed:', event.code, event.reason);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    let localStream;

    (async () => {
      try {
        console.log('🎥 Requesting user media...');
        localStream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 300, height: 300 }, 
          audio: true 
        });
        
        console.log('✅ Got local stream:', localStream.id);
        console.log('📹 Video tracks:', localStream.getVideoTracks().map(t => ({ label: t.label, enabled: t.enabled })));
        console.log('🎵 Audio tracks:', localStream.getAudioTracks().map(t => ({ label: t.label, enabled: t.enabled })));
        
        localStreamRef.current = localStream;
        localVideoRef.current.srcObject = localStream;

        console.log('📤 Sending join message for room:', roomId);
        socket.send(JSON.stringify({ type: "join", room: roomId }));
      } catch (error) {
        console.error('❌ Error accessing user media:', error);
        alert('Error accessing camera/microphone: ' + error.message);
        setJoined(false);
        return;
      }

      socket.onmessage = async ({ data }) => {
        const msg = JSON.parse(data);
        console.log('📨 Received WebSocket message:', msg);

        if (msg.type === "new-peer") {
          const peerId = msg.id;
          console.log('👋 New peer joined:', peerId);
          // Only the existing peer creates the offer to the new peer
          const peer = createPeer(peerId, socket, localStream, true);
          peersRef.current[peerId] = peer;
        }

        if (msg.type === "peer-left") {
          const peerId = msg.id;
          console.log('Peer left:', peerId);
          
          // Close the peer connection
          if (peersRef.current[peerId]) {
            peersRef.current[peerId].close();
            delete peersRef.current[peerId];
          }
          
          // Remove the remote stream
          setRemoteStreams(prev => {
            const newStreams = { ...prev };
            delete newStreams[peerId];
            return newStreams;
          });
        }

        if (msg.type === "existing-peer") {
          console.log('Received existing peers:', msg.peers);
          if (msg.peers && msg.peers.length > 1) {
            alert("Room is full. Only two users allowed.");
            socket.close();
            setJoined(false);
            return;
          }
          // Connect to each existing peer (usually just one for 1-on-1 calls)
          if (msg.peers && msg.peers.length > 0) {
            msg.peers.forEach(peerId => {
              console.log('Connecting to existing peer:', peerId);
              const peer = createPeer(peerId, socket, localStream, true);
              peersRef.current[peerId] = peer;
            });
          } else {
            console.log('No existing peers in room - waiting for others to join');
          }
        }

        if (msg.type === "signal") {
          const { from, data: signal } = msg;
          console.log(`Received signal from ${from}:`, signal.type || 'ICE candidate');
          
          let peer = peersRef.current[from];

          if (!peer) {
            console.log(`Creating new peer for incoming signal from ${from}`);
            // This peer is receiving an offer, so do not create an offer
            peer = createPeer(from, socket, localStream, false);
            peersRef.current[from] = peer;
          }

          try {
            if (signal.type === "offer") {
              console.log(`Processing offer from ${from}`);
              console.log('Offer SDP:', signal.sdp.substring(0, 100) + '...');
              
              await peer.setRemoteDescription(new RTCSessionDescription(signal));
              console.log(`Set remote description for ${from}`);
              
              const answer = await peer.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
              });
              console.log(`Created answer for ${from}`);
              
              await peer.setLocalDescription(answer);
              console.log(`Set local description (answer) for ${from}`);
              
              console.log(`Sending answer to ${from}`);
              socket.send(JSON.stringify({ type: "signal", to: from, data: peer.localDescription }));
              
            } else if (signal.type === "answer") {
              console.log(`Processing answer from ${from}`);
              console.log('Answer SDP:', signal.sdp.substring(0, 100) + '...');
              
              await peer.setRemoteDescription(new RTCSessionDescription(signal));
              console.log(`Set remote description (answer) for ${from}`);
              
            } else if (signal.candidate) {
              console.log(`Adding ICE candidate from ${from}:`, signal.candidate);
              
              await peer.addIceCandidate(new RTCIceCandidate(signal));
              console.log(`Added ICE candidate for ${from}`);
            }
          } catch (error) {
            console.error(`Error processing signal from ${from}:`, error);
          }
        }
      };
    })();

    return () => {
      console.log('Cleaning up WebSocket connection and peers');
      socket.close();
      Object.entries(peersRef.current).forEach(([peerId, peer]) => {
        console.log(`Closing peer connection for ${peerId}`);
        peer.close();
      });
      peersRef.current = {};
      setRemoteStreams({});
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          console.log(`Stopping local track: ${track.kind}`);
          track.stop();
        });
      }
    };
  }, [joined, roomId]);

  function createPeer(peerId, socket, localStream, isOfferer) {
    console.log(`Creating peer connection for ${peerId}, isOfferer: ${isOfferer}`);
    
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    
    // Add local stream tracks
    localStream.getTracks().forEach(track => {
      console.log(`Adding ${track.kind} track to peer ${peerId}:`, track.label);
      peer.addTrack(track, localStream);
    });

    // Handle ICE candidates
    peer.onicecandidate = (e) => {
      if (e.candidate) {
        console.log(`Sending ICE candidate to ${peerId}:`, e.candidate.candidate);
        socket.send(JSON.stringify({ type: "signal", to: peerId, data: e.candidate }));
      } else {
        console.log(`ICE candidate gathering complete for ${peerId}`);
      }
    };

    // Handle incoming tracks (remote streams)
    peer.ontrack = (event) => {
      console.log(`Received ${event.track.kind} track from peer ${peerId}:`, event.track.label);
      console.log('Event streams:', event.streams);
      
      if (event.streams && event.streams.length > 0) {
        const remoteStream = event.streams[0];
        console.log(`Setting remote stream for peer ${peerId}:`, remoteStream.id);
        console.log('Remote stream tracks:', remoteStream.getTracks().map(t => ({ kind: t.kind, label: t.label })));
        
        setRemoteStreams(prev => {
          const updated = { ...prev, [peerId]: remoteStream };
          console.log('Updated remote streams:', Object.keys(updated));
          return updated;
        });
      } else {
        console.warn(`No streams received in ontrack event for peer ${peerId}`);
      }
    };

    // Monitor connection states
    peer.onconnectionstatechange = () => {
      console.log(`Peer ${peerId} connection state:`, peer.connectionState);
      if (peer.connectionState === 'connected') {
        console.log(`✅ Successfully connected to peer ${peerId}`);
      } else if (peer.connectionState === 'failed') {
        console.error(`❌ Connection failed to peer ${peerId}`);
      }
    };

    peer.oniceconnectionstatechange = () => {
      console.log(`Peer ${peerId} ICE connection state:`, peer.iceConnectionState);
    };

    // Create offer if this peer is the offerer
    if (isOfferer) {
      console.log(`Creating offer for peer ${peerId}`);
      peer.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      }).then(offer => {
        console.log(`Created offer for peer ${peerId}:`, offer.type);
        return peer.setLocalDescription(offer);
      }).then(() => {
        console.log(`Sending offer to peer ${peerId}`);
        socket.send(JSON.stringify({ type: "signal", to: peerId, data: peer.localDescription }));
      }).catch(error => {
        console.error(`Error creating offer for peer ${peerId}:`, error);
      });
    }

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
        <div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <div>
              <h3>Local Video (You)</h3>
              <video ref={localVideoRef} autoPlay muted width={300} />
            </div>
            {Object.entries(remoteStreams).map(([peerId, stream]) => {
              console.log(`Rendering remote video for peer ${peerId}:`, stream);
              return (
                <div key={peerId}>
                  <h3>Remote Video ({peerId.substring(0, 8)}...)</h3>
                  <video
                    autoPlay
                    width={300}
                    ref={el => { 
                      if (el && stream) {
                        console.log(`Setting srcObject for peer ${peerId}`);
                        el.srcObject = stream;
                        el.onloadedmetadata = () => {
                          console.log(`✅ Video metadata loaded for peer ${peerId}`);
                          el.play().catch(e => console.error('Play error:', e));
                        };
                      }
                    }}
                    onLoadedMetadata={() => console.log(`Video loaded for peer ${peerId}`)}
                    onError={(e) => console.error(`Video error for peer ${peerId}:`, e)}
                  />
                </div>
              );
            })}
            {Object.keys(remoteStreams).length === 0 && (
              <div>
                <p>Waiting for other participants to join...</p>
              </div>
            )}
          </div>
          
          {/* Debug Information */}
          <div style={{ marginTop: 20, padding: 10, backgroundColor: '#f0f0f0', fontSize: '12px' }}>
            <h4>Debug Info:</h4>
            <p>Room ID: {roomId}</p>
            <p>Connected Peers: {Object.keys(peersRef.current).length}</p>
            <p>Remote Streams: {Object.keys(remoteStreams).length}</p>
            <div>
              Peer IDs: {Object.keys(peersRef.current).map(id => id.substring(0, 8)).join(', ')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
