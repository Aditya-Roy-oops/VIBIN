import React, { useState, useEffect, useRef } from 'react';
import { Mic, Search, Music, Play, Pause, MonitorPlay, Loader2, StopCircle, Waves, Key, Server, Lock, Percent, X, Maximize2, Minimize2, AlertCircle } from 'lucide-react';

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [activeTab, setActiveTab] = useState('audio');
  const [error, setError] = useState('');
  
  // ACRCloud Authentication
  const [acrHost, setAcrHost] = useState(''); 
  const [acrAccessKey, setAcrAccessKey] = useState('');
  const [acrAccessSecret, setAcrAccessSecret] = useState('');

  // Pro-Level Global Player States
  const [nowPlaying, setNowPlaying] = useState(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [fallbackPreview, setFallbackPreview] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const timerRef = useRef(null);
  const fallbackAudioRef = useRef(null);

  // --- AI YOUTUBE MATCHER ---
  const fetchYouTubeIdViaAI = async (title, artist) => {
    const apiKey = ""; // Runtime environment API key
    const userQuery = `Find the 11-character YouTube video ID for the official music video of "${title}" by "${artist}". Return ONLY the 11-character string. If you cannot find it, return 'null'.`;
    
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: "You are a backend system. Output only the 11-character YouTube ID." }] },
            tools: [{ "google_search": {} }]
          })
        }
      );
      
      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      const match = text?.match(/[a-zA-Z0-9_-]{11}/);
      return match ? match[0] : null;
    } catch (err) {
      console.error("Failed to fetch YT ID:", err);
      return null;
    }
  };

  // --- GLOBAL PLAYER LOGIC ---
  const handlePlayTrack = async (track) => {
    setNowPlaying(track);
    setVideoExpanded(false);
    setFallbackPreview(false);
    
    // If we already have the YouTube ID from ACRCloud, play it immediately.
    if (track.youtubeId) {
      setPlayerLoading(false);
      return;
    }

    // Otherwise, we must find the YouTube ID dynamically (Text Search)
    setPlayerLoading(true);
    const fetchedId = await fetchYouTubeIdViaAI(track.title, track.artist);
    
    if (fetchedId) {
      setNowPlaying(prev => ({ ...prev, youtubeId: fetchedId }));
    } else if (track.previewUrl) {
      // Fallback to high-quality audio preview if YT video is missing
      setFallbackPreview(true);
    } else {
      setError("No playable source found for this track.");
      setNowPlaying(null);
    }
    setPlayerLoading(false);
  };

  const closePlayer = () => {
    setNowPlaying(null);
    setVideoExpanded(false);
    if (fallbackAudioRef.current) {
      fallbackAudioRef.current.pause();
    }
  };

  // --- TEXT SEARCH LOGIC (iTunes API) ---
  const handleTextSearch = async (e) => {
    e?.preventDefault();
    if (!searchQuery.trim()) return;

    setIsProcessing(true);
    setError('');
    setResults([]);
    
    try {
      const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&entity=song&limit=15`);
      const data = await response.json();
      
      if (data.results.length === 0) {
        setError("No songs found. Try another search.");
      } else {
        setResults(data.results.map(track => ({
          id: track.trackId.toString(),
          title: track.trackName,
          artist: track.artistName,
          album: track.collectionName,
          coverArt: track.artworkUrl100.replace('100x100', '400x400'),
          previewUrl: track.previewUrl,
          youtubeId: null, // Will be fetched when user clicks Play
          score: null 
        })));
      }
    } catch (err) {
      setError("Failed to connect to the search service.");
    } finally {
      setIsProcessing(false);
    }
  };

  // --- AUDIO RECOGNITION LOGIC (ACRCloud) ---
  const generateACRSignature = async (timestamp) => {
    const stringToSign = ['POST', '/v1/identify', acrAccessKey, 'audio', '1', timestamp].join('\n');
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(acrAccessSecret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(stringToSign));
    return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(signatureBuffer))));
  };

  const startRecording = async () => {
    if (!acrHost || !acrAccessKey || !acrAccessSecret) {
      setError("Please configure your ACRCloud credentials below.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsRecording(true);
      setError('');
      setRecordingTime(0);
      setResults([]);

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      analyserRef.current.fftSize = 256;

      drawVisualizer();

      let chunks = [];
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorderRef.current.onstop = () => {
        processRealAudio(new Blob(chunks, { type: 'audio/webm' }));
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
      mediaRecorderRef.current.stop(); 
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      clearInterval(timerRef.current);
      cancelAnimationFrame(animationFrameRef.current);
      
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    }
  };

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

      let urlHost = acrHost.trim();
      if (!urlHost.startsWith('http')) urlHost = `https://${urlHost}`;

      const response = await fetch(`${urlHost}/v1/identify`, { method: 'POST', body: formData });
      const data = await response.json();

      if (data.status && data.status.code === 0 && data.metadata && data.metadata.music) {
        const matches = data.metadata.music.slice(0, 5);
        setResults(matches.map(track => {
          const artistName = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown Artist';
          return {
            id: track.acrid || Math.random().toString(),
            title: track.title,
            artist: artistName,
            album: track.album?.name || "Unknown Album",
            score: track.score, 
            coverArt: 'https://unsplash.com/illustrations/a-yellow-record-spins-on-a-pink-background-HPCrgyz5USk?w=400&h=400&fit=crop',
            
            previewUrl: null, 
            youtubeId: track.external_metadata?.youtube?.vid || null, 
          };
        }));
      } else {
        setError(data.status?.msg || "Could not identify the song. Try holding it closer to the audio source.");
      }
    } catch (err) {
      setError("Audio processing failed. Check your network and ACRCloud credentials.");
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
      canvasCtx.fillStyle = '#09090b'; // match background
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = dataArray[i] / 2;
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
    <div className="min-h-screen bg-[#09090b] text-white font-sans selection:bg-pink-500 selection:text-white">
      {/* Top Navigation */}
      <header className="px-8 py-5 border-b border-white/5 flex items-center justify-between bg-[#09090b]/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-pink-500 flex items-center justify-center shadow-[0_0_20px_rgba(236,72,153,0.3)]">
            <Waves className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tighter text-white">
            VIBIN
          </h1>
        </div>
        
        {/* Navigation Tabs */}
        <div className="hidden md:flex bg-white/5 rounded-full p-1 border border-white/5">
          <button onClick={() => setActiveTab('audio')} className={`px-6 py-2 rounded-full text-xs font-bold tracking-widest transition-all ${activeTab === 'audio' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}>
            IDENTIFY
          </button>
          <button onClick={() => setActiveTab('text')} className={`px-6 py-2 rounded-full text-xs font-bold tracking-widest transition-all ${activeTab === 'text' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}>
            SEARCH
          </button>
        </div>
      </header>

      {/* Main Container - adds padding bottom if player is active so content isn't hidden */}
      <main className={`max-w-4xl mx-auto p-6 md:p-10 transition-all duration-300 ${nowPlaying ? 'pb-40' : 'pb-10'}`}>
        
        {/* Mobile Tabs Fallback */}
        <div className="md:hidden flex bg-white/5 rounded-full p-1 mb-8 border border-white/5">
          <button onClick={() => setActiveTab('audio')} className={`flex-1 py-3 rounded-full text-xs font-bold tracking-widest transition-all ${activeTab === 'audio' ? 'bg-white text-black' : 'text-gray-400'}`}>IDENTIFY</button>
          <button onClick={() => setActiveTab('text')} className={`flex-1 py-3 rounded-full text-xs font-bold tracking-widest transition-all ${activeTab === 'text' ? 'bg-white text-black' : 'text-gray-400'}`}>SEARCH</button>
        </div>

        {/* Audio Search Interface */}
        {activeTab === 'audio' && (
          <div className="flex flex-col items-center w-full animate-in fade-in zoom-in-95 duration-500">
            
            <div className="relative group my-12">
              {isRecording && <div className="absolute inset-0 bg-pink-500 rounded-full animate-ping opacity-20 scale-150"></div>}
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                className={`relative z-10 w-40 h-40 rounded-full flex flex-col items-center justify-center transition-all duration-300 shadow-2xl ${
                  isRecording 
                    ? 'bg-red-500 hover:bg-red-600 shadow-red-500/40 scale-110' 
                    : isProcessing
                    ? 'bg-white/10 cursor-not-allowed border border-white/5'
                    : 'bg-gradient-to-tr from-violet-600 to-pink-500 hover:scale-105 shadow-pink-500/30'
                }`}
              >
                {isProcessing ? (
                  <Loader2 className="w-12 h-12 text-white animate-spin mb-2" />
                ) : isRecording ? (
                  <StopCircle className="w-12 h-12 text-white mb-2" />
                ) : (
                  <Mic className="w-12 h-12 text-white mb-2" />
                )}
                <span className="text-xs font-bold tracking-widest text-white/90">
                  {isProcessing ? 'ANALYZING' : isRecording ? 'STOP' : 'TAP TO HUM'}
                </span>
              </button>
            </div>

            <div className="h-8 text-center mb-8">
              {isRecording && <p className="text-pink-400 font-bold tracking-widest text-sm animate-pulse">LISTENING... {recordingTime}S</p>}
            </div>

            <canvas ref={canvasRef} width="400" height="80" className={`rounded-xl transition-opacity duration-500 mb-12 ${isRecording ? 'opacity-100' : 'opacity-0'}`} />

            {/* Admin Settings for ACRCloud */}
            <div className="w-full max-w-md bg-white/5 p-6 rounded-3xl border border-white/10 backdrop-blur-md">
              <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
                <Server className="w-4 h-4" /> ACRCloud Settings
              </h3>
              <div className="space-y-3">
                <input type="text" placeholder="Host URL (e.g. identify-us...)" value={acrHost} onChange={(e) => setAcrHost(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-xl py-3 px-4 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-pink-500 transition-all" />
                <input type="text" placeholder="Access Key" value={acrAccessKey} onChange={(e) => setAcrAccessKey(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-xl py-3 px-4 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-pink-500 transition-all" />
                <input type="password" placeholder="Access Secret" value={acrAccessSecret} onChange={(e) => setAcrAccessSecret(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-xl py-3 px-4 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-pink-500 transition-all" />
              </div>
            </div>
          </div>
        )}

        {/* Text Search Interface */}
        {activeTab === 'text' && (
          <div className="w-full max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-500">
            <form onSubmit={handleTextSearch} className="relative group">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search songs, artists, or albums..."
                className="w-full bg-white/5 border border-white/10 hover:border-white/20 rounded-3xl py-6 pl-14 pr-32 text-lg text-white placeholder-gray-500 focus:outline-none focus:border-pink-500 focus:bg-white/10 transition-all shadow-2xl"
              />
              <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-500 group-focus-within:text-pink-500 transition-colors" />
              <button 
                type="submit"
                disabled={isProcessing}
                className="absolute right-3 top-3 bottom-3 bg-white text-black hover:bg-gray-200 px-6 rounded-2xl text-xs font-black tracking-widest transition-colors flex items-center justify-center"
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'SEARCH'}
              </button>
            </form>
          </div>
        )}

        {/* Global Error State */}
        {error && (
          <div className="w-full max-w-2xl mx-auto mt-8 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center gap-3 text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Search Results List */}
        {results.length > 0 && (
          <div className="w-full mt-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <h2 className="text-sm font-bold tracking-widest text-gray-500 mb-6 px-2">
              {activeTab === 'audio' ? 'MATCH RESULTS' : 'TOP RESULTS'}
            </h2>
            
            <div className="flex flex-col gap-3">
              {results.map((track, index) => (
                <div key={track.id} onClick={() => handlePlayTrack(track)} className={`group bg-white/5 border border-white/5 hover:border-white/20 hover:bg-white/10 rounded-2xl p-3 flex items-center gap-4 transition-all cursor-pointer ${nowPlaying?.id === track.id ? 'bg-white/10 border-pink-500/50 ring-1 ring-pink-500/50' : ''}`}>
                  
                  {/* Track Rank / Play Overlay */}
                  <div className="relative w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-black/50">
                    <img src={track.coverArt} alt={track.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="w-6 h-6 text-white fill-white" />
                    </div>
                  </div>

                  {/* Track Info */}
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className={`text-base font-bold truncate ${nowPlaying?.id === track.id ? 'text-pink-400' : 'text-white'}`}>
                        {track.title}
                      </h3>
                      {track.score && (
                        <span className="shrink-0 text-[9px] font-black tracking-widest bg-white/10 text-gray-300 px-2 py-0.5 rounded-md">
                          {track.score}% MATCH
                        </span>
                      )}
                    </div>
                    <p className="text-gray-400 text-sm truncate">{track.artist}</p>
                  </div>

                  {/* Context Actions (Visual only, clicking row plays) */}
                  <div className="hidden sm:flex shrink-0 pr-4">
                    <button className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-gray-400 group-hover:text-white group-hover:bg-white/20 transition-all">
                      <MonitorPlay className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* --- PRO GLOBAL BOTTOM PLAYER --- */}
      {nowPlaying && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#09090b]/95 backdrop-blur-2xl border-t border-white/10 z-50 animate-in slide-in-from-bottom-full duration-500 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
            
            {/* Left: Track Info */}
            <div className="flex items-center gap-4 w-1/3 min-w-0">
              <img src={nowPlaying.coverArt} className="w-14 h-14 rounded-lg object-cover shadow-lg border border-white/5" alt="Cover" />
              <div className="min-w-0">
                <p className="font-bold text-white truncate">{nowPlaying.title}</p>
                <p className="text-gray-400 text-xs truncate mt-0.5">{nowPlaying.artist}</p>
              </div>
            </div>

            {/* Center: Playback UI (YouTube Iframe or Native Audio) */}
            <div className="flex-1 flex justify-center items-center">
              {playerLoading ? (
                <div className="flex items-center gap-3 text-pink-500 bg-pink-500/10 px-6 py-2 rounded-full border border-pink-500/20">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs font-bold tracking-widest">LOADING SOURCE...</span>
                </div>
              ) : nowPlaying.youtubeId ? (
                // --- INLINE YOUTUBE PLAYER ---
                <div className={`transition-all duration-500 origin-bottom ${videoExpanded ? 'fixed bottom-24 right-6 w-[400px] sm:w-[500px] aspect-video rounded-2xl overflow-hidden shadow-2xl border border-white/10 z-50 bg-black' : 'w-32 h-14 rounded-lg overflow-hidden border border-white/5 opacity-50 hover:opacity-100'}`}>
                  <iframe
                    width="100%"
                    height="100%"
                    src={`https://www.youtube.com/embed/${nowPlaying.youtubeId}?autoplay=1&controls=${videoExpanded ? 1 : 0}&modestbranding=1`}
                    title="YouTube Video"
                    frameBorder="0"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                  />
                </div>
              ) : fallbackPreview && nowPlaying.previewUrl ? (
                // --- FALLBACK AUDIO PLAYER ---
                <audio ref={fallbackAudioRef} src={nowPlaying.previewUrl} autoPlay controls className="w-full max-w-md h-10 outline-none" />
              ) : (
                <p className="text-red-400 text-xs font-bold">UNABLE TO PLAY TRACK</p>
              )}
            </div>

            {/* Right: Player Controls */}
            <div className="flex items-center justify-end gap-2 w-1/3">
              {nowPlaying.youtubeId && !playerLoading && (
                <button 
                  onClick={() => setVideoExpanded(!videoExpanded)} 
                  className={`p-3 rounded-full transition-all ${videoExpanded ? 'bg-pink-500 text-white shadow-[0_0_15px_rgba(236,72,153,0.5)]' : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'}`}
                  title={videoExpanded ? "Minimize Video" : "Watch Full Video"}
                >
                  {videoExpanded ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                </button>
              )}
              <button 
                onClick={closePlayer} 
                className="p-3 bg-white/5 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                title="Close Player"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
