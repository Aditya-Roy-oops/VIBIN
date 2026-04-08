import React, { useState, useEffect, useRef } from 'react';
import { Mic, Search, Music, Play, MonitorPlay, Disc3, Loader2, StopCircle, Waves, Key, Server, Lock } from 'lucide-react';

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [activeTab, setActiveTab] = useState('audio');
  const [error, setError] = useState('');
  
  // ACRCloud requires 3 pieces of information for authentication
  const [acrHost, setAcrHost] = useState(''); 
  const [acrAccessKey, setAcrAccessKey] = useState('');
  const [acrAccessSecret, setAcrAccessSecret] = useState('');

  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const timerRef = useRef(null);

  // Live Text Search using iTunes API (Free, no API key needed)
  const handleTextSearch = async (e) => {
    e?.preventDefault();
    if (!searchQuery.trim()) return;

    setIsProcessing(true);
    setError('');
    
    try {
      const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&entity=song&limit=10`);
      const data = await response.json();
      
      if (data.results.length === 0) {
        setError("No songs found. Try another search.");
        setResults([]);
      } else {
        setResults(data.results.map(track => ({
          id: track.trackId,
          title: track.trackName,
          artist: track.artistName,
          album: track.collectionName,
          coverArt: track.artworkUrl100.replace('100x100', '300x300'),
          previewUrl: track.previewUrl,
          spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(track.trackName + ' ' + track.artistName)}`,
          youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(track.trackName + ' ' + track.artistName)}`,
          appleUrl: track.trackViewUrl
        })));
      }
    } catch (err) {
      setError("Failed to connect to the search service.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Generate HMAC-SHA1 signature required by ACRCloud using native Web Crypto API
  const generateACRSignature = async (timestamp) => {
    const stringToSign = ['POST', '/v1/identify', acrAccessKey, 'audio', '1', timestamp].join('\n');
    const encoder = new TextEncoder();
    const keyData = encoder.encode(acrAccessSecret);
    const msgData = encoder.encode(stringToSign);

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    
    // Convert buffer to base64
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    return btoa(String.fromCharCode.apply(null, signatureArray));
  };

  // Start Real Audio Recording
  const startRecording = async () => {
    if ((!acrHost || !acrAccessKey || !acrAccessSecret) && activeTab === 'audio') {
      setError("Please fill in your ACRCloud Host, Access Key, and Access Secret below.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsRecording(true);
      setError('');
      setRecordingTime(0);
      setResults([]);

      // Setup Web Audio API for visualizer
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      analyserRef.current.fftSize = 256;

      drawVisualizer();

      // Setup MediaRecorder to capture audio chunks
      let chunks = [];
      mediaRecorderRef.current = new MediaRecorder(stream);
      
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      // When recording stops, process the chunks into a file and send to API
      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        processRealAudio(audioBlob);
      };

      mediaRecorderRef.current.start();

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= 10) {
            stopRecording();
            return 10;
          }
          return prev + 1;
        });
      }, 1000);

    } catch (err) {
      setError("Microphone access denied or unavailable.");
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop(); // Triggers the onstop event
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      clearInterval(timerRef.current);
      cancelAnimationFrame(animationFrameRef.current);
      
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    }
  };

  // Real API Call to ACRCloud
  const processRealAudio = async (audioBlob) => {
    setIsProcessing(true);
    setError('');

    try {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = await generateACRSignature(timestamp);

      const formData = new FormData();
      formData.append('sample', audioBlob);
      formData.append('sample_bytes', audioBlob.size.toString());
      formData.append('access_key', acrAccessKey);
      formData.append('data_type', 'audio');
      formData.append('signature_version', '1');
      formData.append('signature', signature);
      formData.append('timestamp', timestamp);

      // Clean up the host just in case the user added https://
      let urlHost = acrHost.trim();
      if (!urlHost.startsWith('http')) {
        urlHost = `https://${urlHost}`;
      }

      const response = await fetch(`${urlHost}/v1/identify`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();

      if (data.status && data.status.code === 0 && data.metadata && data.metadata.music) {
        // ACRCloud returns an array of possible matches, we take the best one (first)
        const track = data.metadata.music[0];
        const artistName = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown Artist';
        
        // Grab external IDs to build links directly if ACRCloud provides them
        const spotifyId = track.external_metadata?.spotify?.track?.id;
        const youtubeId = track.external_metadata?.youtube?.vid;

        setResults([{
          id: track.acrid || Math.random().toString(),
          title: track.title,
          artist: artistName,
          album: track.album?.name || "Unknown Album",
          // ACRCloud base tier doesn't always provide album art URLs directly, using placeholder as fallback
          coverArt: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?w=300&h=300&fit=crop',
          previewUrl: '', // No direct preview audio URL provided by standard ACRCloud
          spotifyUrl: spotifyId ? `https://open.spotify.com/track/${spotifyId}` : `https://open.spotify.com/search/${encodeURIComponent(track.title + ' ' + artistName)}`,
          youtubeUrl: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(track.title + ' ' + artistName)}`,
          appleUrl: `https://music.apple.com/us/search?term=${encodeURIComponent(track.title + ' ' + artistName)}`
        }]);
      } else {
        setError(data.status?.msg || "Could not identify the song. Try holding the mic closer to the music.");
        setResults([]);
      }
    } catch (err) {
      console.error(err);
      setError("Audio processing failed. Check your network, Host URL, or API keys.");
    } finally {
      setIsProcessing(false);
    }
  };

  const drawVisualizer = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);
      analyserRef.current.getByteFrequencyData(dataArray);

      canvasCtx.fillStyle = '#121212';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;
        const gradient = canvasCtx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, '#8b5cf6');
        gradient.addColorStop(1, '#ec4899');
        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 2;
      }
    };
    draw();
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#121212] text-white font-sans selection:bg-pink-500 selection:text-white">
      {/* Header */}
      <header className="p-6 border-b border-gray-800 flex items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-violet-600 to-pink-500 flex items-center justify-center shadow-lg shadow-pink-500/20">
          <Waves className="w-6 h-6 text-white" />
        </div>
        <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-pink-400">
          VIBIN
        </h1>
      </header>

      <main className="max-w-3xl mx-auto p-6 flex flex-col items-center">
        
        {/* Tabs */}
        <div className="flex bg-gray-900 rounded-full p-1 mb-12 w-full max-w-sm">
          <button
            onClick={() => setActiveTab('audio')}
            className={`flex-1 py-2 rounded-full text-sm font-medium transition-all ${
              activeTab === 'audio' ? 'bg-gray-800 shadow text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Audio Recognition
          </button>
          <button
            onClick={() => setActiveTab('text')}
            className={`flex-1 py-2 rounded-full text-sm font-medium transition-all ${
              activeTab === 'text' ? 'bg-gray-800 shadow text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Search by Text
          </button>
        </div>

        {/* Audio Search UI */}
        {activeTab === 'audio' && (
          <div className="flex flex-col items-center w-full min-h-[300px]">
            
            {/* ACRCloud API Credentials Inputs */}
            <div className="w-full max-w-sm mb-8 space-y-3">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Server className="h-4 w-4 text-gray-500" />
                </div>
                <input
                  type="text"
                  placeholder="Host (e.g. identify-us-west-2.acrcloud.com)"
                  value={acrHost}
                  onChange={(e) => setAcrHost(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
                />
              </div>
              
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Key className="h-4 w-4 text-gray-500" />
                </div>
                <input
                  type="text"
                  placeholder="Access Key"
                  value={acrAccessKey}
                  onChange={(e) => setAcrAccessKey(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
                />
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-gray-500" />
                </div>
                <input
                  type="password"
                  placeholder="Access Secret"
                  value={acrAccessSecret}
                  onChange={(e) => setAcrAccessSecret(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
                />
              </div>

              <p className="text-xs text-gray-500 mt-2 text-center">
                Create an Audio Recognition project at <a href="https://console.acrcloud.com" target="_blank" rel="noreferrer" className="text-pink-400 hover:underline">console.acrcloud.com</a> to get credentials.
              </p>
            </div>

            <div className="relative mb-8">
              {isRecording && (
                <div className="absolute inset-0 bg-pink-500 rounded-full animate-ping opacity-20 scale-150"></div>
              )}
              
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                className={`relative z-10 w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl ${
                  isRecording 
                    ? 'bg-red-500 hover:bg-red-600 shadow-red-500/40' 
                    : isProcessing
                    ? 'bg-gray-800 cursor-not-allowed'
                    : 'bg-gradient-to-tr from-violet-600 to-pink-500 hover:scale-105 shadow-pink-500/30'
                }`}
              >
                {isProcessing ? (
                  <Loader2 className="w-12 h-12 text-white animate-spin" />
                ) : isRecording ? (
                  <StopCircle className="w-12 h-12 text-white" />
                ) : (
                  <Mic className="w-12 h-12 text-white" />
                )}
              </button>
            </div>

            <div className="h-8 text-center">
              {isRecording ? (
                <p className="text-pink-400 font-medium animate-pulse">Listening... {recordingTime}s (max 10s)</p>
              ) : isProcessing ? (
                <p className="text-violet-400 font-medium animate-pulse">Sending to ACRCloud...</p>
              ) : (
                <p className="text-gray-400">Play music near your microphone to identify it.</p>
              )}
            </div>

            <canvas 
              ref={canvasRef} 
              width="300" 
              height="60" 
              className={`mt-6 rounded-lg transition-opacity duration-300 ${isRecording ? 'opacity-100' : 'opacity-0'}`}
            />
          </div>
        )}

        {/* Text Search UI */}
        {activeTab === 'text' && (
          <div className="w-full max-w-xl min-h-[300px]">
            <form onSubmit={handleTextSearch} className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for a song, artist, or lyrics..."
                className="w-full bg-gray-900 border border-gray-700 rounded-2xl py-4 pl-12 pr-4 text-white placeholder-gray-500 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
              />
              <Search className="absolute left-4 top-4 w-6 h-6 text-gray-500" />
              <button 
                type="submit"
                disabled={isProcessing}
                className="absolute right-2 top-2 bottom-2 bg-gray-800 hover:bg-gray-700 px-4 rounded-xl text-sm font-medium transition-colors"
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Search'}
              </button>
            </form>
            <p className="text-center text-gray-500 text-sm mt-4">Powered by iTunes Search API (Free)</p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="w-full max-w-xl p-4 mt-6 bg-red-500/10 border border-red-500/50 rounded-xl text-red-400 text-center">
            {error}
          </div>
        )}

        {/* Results Area */}
        {results.length > 0 && (
          <div className="w-full max-w-xl mt-12 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-xl font-bold mb-4">Results</h2>
            {results.map((track) => (
              <div key={track.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 items-center hover:border-gray-700 transition-colors">
                
                {/* Album Art & Preview Player */}
                <div className="relative group w-24 h-24 shrink-0">
                  <img src={track.coverArt} alt={track.title} className="w-full h-full rounded-xl object-cover shadow-lg" />
                  {track.previewUrl && (
                    <button 
                      onClick={() => {
                        const audio = new Audio(track.previewUrl);
                        audio.play();
                      }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl"
                    >
                      <Play className="w-8 h-8 text-white fill-white" />
                    </button>
                  )}
                </div>

                {/* Track Info */}
                <div className="flex-1 text-center sm:text-left min-w-0">
                  <h3 className="text-lg font-bold text-white truncate">{track.title}</h3>
                  <p className="text-gray-400 truncate">{track.artist}</p>
                  <p className="text-gray-500 text-sm truncate mt-1">{track.album}</p>
                </div>

                {/* External Links */}
                <div className="flex sm:flex-col gap-2 shrink-0">
                  <a href={track.spotifyUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-800 hover:bg-[#1DB954] hover:text-white text-gray-400 transition-colors tooltip-trigger" title="Search on Spotify">
                    <Music className="w-5 h-5" />
                  </a>
                  <a href={track.youtubeUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-800 hover:bg-[#FF0000] hover:text-white text-gray-400 transition-colors" title="Search on YouTube">
                    <MonitorPlay className="w-5 h-5" />
                  </a>
                  {track.appleUrl && (
                    <a href={track.appleUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-800 hover:bg-white hover:text-black text-gray-400 transition-colors" title="View on Apple Music">
                      <Disc3 className="w-5 h-5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
