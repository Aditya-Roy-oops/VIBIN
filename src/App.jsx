import React, { useState, useEffect, useRef } from 'react';
import { Mic, Search, Music, Play, Pause, MonitorPlay, Disc3, Loader2, StopCircle, Waves, Key, Server, Lock, Percent, X, Youtube, AlertCircle } from 'lucide-react';

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

  // Player States
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [openIframeId, setOpenIframeId] = useState(null);
  const [fetchingId, setFetchingId] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const timerRef = useRef(null);
  const audioRef = useRef(null);

  // Gemini AI helper for fetching YouTube IDs for songs that don't have them
  const getYouTubeIdViaAI = async (title, artist) => {
    const apiKey = ""; // Provided by environment
    const userQuery = `Find the 11-character YouTube video ID for the official music video of "${title}" by "${artist}". Return ONLY the 11-character string. If not found, return 'null'.`;
    const systemPrompt = "You are a music expert. Find the correct YouTube video ID. Do not include any text other than the ID.";

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            tools: [{ "google_search": {} }]
          })
        }
      );
      
      const result = await response.json();
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      const match = text?.match(/[a-zA-Z0-9_-]{11}/);
      return match ? match[0] : null;
    } catch (err) {
      console.error("AI Fetch failed:", err);
      return null;
    }
  };

  // Logic to handle playing full video without redirecting
  const handlePlayFull = async (track) => {
    if (openIframeId === track.id) {
      setOpenIframeId(null);
      return;
    }

    // Stop background preview if it's playing
    setIsPlaying(false);

    if (track.youtubeId) {
      setOpenIframeId(track.id);
      return;
    }

    // If no ID exists, fetch it using AI
    setFetchingId(track.id);
    const videoId = await getYouTubeIdViaAI(track.title, track.artist);
    
    if (videoId) {
      setResults(prev => prev.map(t => t.id === track.id ? { ...t, youtubeId: videoId } : t));
      setOpenIframeId(track.id);
    } else {
      setError("Could not find a playable video source for this song.");
    }
    setFetchingId(null);
  };

  // Preview Logic (30s clips from iTunes)
  const togglePreview = (track) => {
    if (!track.previewUrl) return;
    if (currentTrack?.id === track.id) {
      setIsPlaying(!isPlaying);
    } else {
      setOpenIframeId(null); // Close video if playing audio
      setCurrentTrack(track);
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    if (audioRef.current && currentTrack) {
      if (isPlaying) {
        audioRef.current.play().catch(() => setIsPlaying(false));
      } else {
        audioRef.current.pause();
      }
    }
  }, [currentTrack, isPlaying]);

  const handleTextSearch = async (e) => {
    e?.preventDefault();
    if (!searchQuery.trim()) return;

    setIsProcessing(true);
    setError('');
    setOpenIframeId(null);
    setResults([]);
    
    try {
      const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchQuery)}&entity=song&limit=10`);
      const data = await response.json();
      
      if (data.results.length === 0) {
        setError("No songs found.");
      } else {
        setResults(data.results.map(track => ({
          id: track.trackId.toString(),
          title: track.trackName,
          artist: track.artistName,
          album: track.collectionName,
          coverArt: track.artworkUrl100.replace('100x100', '400x400'),
          previewUrl: track.previewUrl,
          youtubeId: null, // Will fetch on demand
          spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(track.trackName + ' ' + track.artistName)}`,
        })));
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const generateACRSignature = async (timestamp) => {
    const stringToSign = ['POST', '/v1/identify', acrAccessKey, 'audio', '1', timestamp].join('\n');
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(acrAccessSecret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(stringToSign));
    return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(signatureBuffer))));
  };

  const startRecording = async () => {
    if (!acrHost || !acrAccessKey || !acrAccessSecret) {
      setError("Please enter your ACRCloud credentials.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsRecording(true);
      setError('');
      setRecordingTime(0);
      setResults([]);
      setOpenIframeId(null);
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      audioContextRef.current.createMediaStreamSource(stream).connect(analyserRef.current);
      drawVisualizer();
      let chunks = [];
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorderRef.current.onstop = () => processAudioMatch(new Blob(chunks, { type: 'audio/webm' }));
      mediaRecorderRef.current.start();
      timerRef.current = setInterval(() => setRecordingTime(p => p >= 10 ? (stopRecording(), 10) : p + 1), 1000);
    } catch (err) {
      setError("Microphone access denied.");
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      setIsRecording(false);
      clearInterval(timerRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    }
  };

  const processAudioMatch = async (audioBlob) => {
    setIsProcessing(true);
    try {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = await generateACRSignature(timestamp);
      const formData = new FormData();
      formData.append('sample', audioBlob);
      formData.append('access_key', acrAccessKey);
      formData.append('data_type', 'audio');
      formData.append('signature_version', '1');
      formData.append('signature', signature);
      formData.append('timestamp', timestamp);
      const host = acrHost.startsWith('http') ? acrHost : `https://${acrHost}`;
      const response = await fetch(`${host}/v1/identify`, { method: 'POST', body: formData });
      const data = await response.json();
      if (data.status?.code === 0 && data.metadata?.music) {
        setResults(data.metadata.music.slice(0, 5).map(track => ({
          id: track.acrid,
          title: track.title,
          artist: track.artists?.[0]?.name || 'Unknown',
          album: track.album?.name || "Unknown",
          score: track.score,
          coverArt: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?w=400&h=400&fit=crop',
          youtubeId: track.external_metadata?.youtube?.vid,
          spotifyUrl: track.external_metadata?.spotify?.track?.id ? `https://open.spotify.com/track/${track.external_metadata.spotify.track.id}` : null
        })));
      } else {
        setError("Song not recognized. Try again.");
      }
    } catch (err) {
      setError("Recognition failed. Check your API Host URL.");
    } finally {
      setIsProcessing(false);
    }
  };

  const drawVisualizer = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);
      analyserRef.current.getByteFrequencyData(dataArray);
      ctx.fillStyle = '#121212';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / dataArray.length) * 2.5;
      let x = 0;
      dataArray.forEach(val => {
        const barHeight = val / 2.5;
        const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
        grad.addColorStop(0, '#8b5cf6');
        grad.addColorStop(1, '#ec4899');
        ctx.fillStyle = grad;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 2;
      });
    };
    draw();
  };

  return (
    <div className="min-h-screen bg-[#121212] text-white font-sans selection:bg-pink-500">
      <header className="p-6 border-b border-gray-800 flex items-center justify-center gap-3 bg-[#121212]/80 backdrop-blur-md sticky top-0 z-50">
        <Waves className="w-8 h-8 text-pink-500" />
        <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-pink-400 tracking-tighter">VIBIN</h1>
      </header>

      <main className={`max-w-3xl mx-auto p-6 flex flex-col items-center transition-all ${currentTrack ? 'pb-36' : ''}`}>
        <div className="flex bg-gray-900 rounded-full p-1 mb-10 w-full max-w-xs border border-gray-800 shadow-inner">
          <button onClick={() => setActiveTab('audio')} className={`flex-1 py-2 rounded-full text-xs font-black tracking-widest transition-all ${activeTab === 'audio' ? 'bg-gray-800 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}>AUDIO</button>
          <button onClick={() => setActiveTab('text')} className={`flex-1 py-2 rounded-full text-xs font-black tracking-widest transition-all ${activeTab === 'text' ? 'bg-gray-800 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}>TEXT</button>
        </div>

        {activeTab === 'audio' && (
          <div className="w-full space-y-8 flex flex-col items-center">
            <div className="w-full max-w-sm space-y-2 bg-gray-900/50 p-5 rounded-3xl border border-gray-800 backdrop-blur-sm">
              <input type="text" placeholder="ACRCloud Host URL" value={acrHost} onChange={e => setAcrHost(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-xl py-2 px-4 text-xs focus:border-pink-500 outline-none transition-all" />
              <input type="text" placeholder="Access Key" value={acrAccessKey} onChange={e => setAcrAccessKey(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-xl py-2 px-4 text-xs focus:border-pink-500 outline-none transition-all" />
              <input type="password" placeholder="Access Secret" value={acrAccessSecret} onChange={e => setAcrAccessSecret(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-xl py-2 px-4 text-xs focus:border-pink-500 outline-none transition-all" />
            </div>
            
            <div className="relative group">
              {isRecording && <div className="absolute inset-0 bg-pink-500 rounded-full animate-ping opacity-20 scale-150"></div>}
              <button onClick={isRecording ? stopRecording : startRecording} disabled={isProcessing} className={`w-32 h-32 rounded-full flex items-center justify-center transition-all shadow-2xl ${isRecording ? 'bg-red-500' : 'bg-gradient-to-tr from-violet-600 to-pink-500 hover:scale-105 active:scale-95'}`}>
                {isProcessing ? <Loader2 className="w-12 h-12 animate-spin" /> : isRecording ? <StopCircle className="w-12 h-12" /> : <Mic className="w-12 h-12" />}
              </button>
            </div>
            <p className="text-gray-500 text-sm font-bold uppercase tracking-widest h-4">{isRecording ? `Listening... ${recordingTime}s` : 'Hum, Sing, or Listen'}</p>
            <canvas ref={canvasRef} width="320" height="60" className={`rounded-lg transition-opacity duration-500 ${isRecording ? 'opacity-100' : 'opacity-0'}`} />
          </div>
        )}

        {activeTab === 'text' && (
          <form onSubmit={handleTextSearch} className="w-full max-w-xl relative group">
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search music by name..." className="w-full bg-gray-900 border border-gray-800 rounded-2xl py-5 pl-14 pr-4 focus:ring-2 focus:ring-pink-500 outline-none transition-all shadow-2xl placeholder:text-gray-600" />
            <Search className="absolute left-5 top-5 w-6 h-6 text-gray-600 group-focus-within:text-pink-500 transition-colors" />
            <button type="submit" disabled={isProcessing} className="absolute right-3 top-2.5 bottom-2.5 bg-gray-800 hover:bg-gray-700 px-6 rounded-xl text-xs font-black tracking-widest transition-all">{isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'SEARCH'}</button>
          </form>
        )}

        {error && <div className="w-full max-w-xl p-4 mt-8 bg-red-500/10 border border-red-500/50 rounded-2xl text-red-400 text-center flex items-center justify-center gap-2 font-bold text-sm"><AlertCircle className="w-4 h-4" /> {error}</div>}

        <div className="w-full max-w-xl mt-12 space-y-4">
          {results.map((track) => (
            <div key={track.id} className="bg-gray-900/40 border border-gray-800/50 rounded-[32px] p-6 hover:border-gray-600 hover:bg-gray-900/60 transition-all group shadow-xl">
              <div className="flex gap-6 items-center">
                <div className="relative w-24 h-24 shrink-0 cursor-pointer shadow-lg" onClick={() => handlePlayFull(track)}>
                  <img src={track.coverArt} alt="" className="w-full h-full rounded-2xl object-cover" />
                  <div className={`absolute inset-0 bg-black/40 rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${openIframeId === track.id ? 'opacity-100' : ''}`}>
                    {fetchingId === track.id ? <Loader2 className="w-10 h-10 animate-spin text-white" /> : openIframeId === track.id ? <Pause className="w-10 h-10 fill-white text-white" /> : <Play className="w-10 h-10 fill-white text-white" />}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  {track.score && <span className="text-[10px] font-black bg-pink-600/20 text-pink-500 border border-pink-500/30 px-2 py-0.5 rounded-full mb-1 inline-block uppercase tracking-wider">{track.score}% MATCH</span>}
                  <h3 className="text-xl font-black truncate leading-tight tracking-tight">{track.title}</h3>
                  <p className="text-gray-400 text-sm font-medium truncate mb-4">{track.artist}</p>
                  
                  <div className="flex gap-3">
                    <button onClick={() => handlePlayFull(track)} disabled={fetchingId === track.id} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all shadow-md ${openIframeId === track.id ? 'bg-red-600 text-white' : 'bg-gray-800 hover:bg-red-600 text-gray-300'}`}>
                      {fetchingId === track.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MonitorPlay className="w-3.5 h-3.5" />}
                      {openIframeId === track.id ? 'CLOSE PLAYER' : 'PLAY FULL SONG'}
                    </button>
                    {track.previewUrl && (
                      <button onClick={() => togglePreview(track)} className={`p-2.5 rounded-xl transition-all shadow-md ${currentTrack?.id === track.id && isPlaying ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-violet-600'}`}>
                        <Music className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {openIframeId === track.id && track.youtubeId && (
                <div className="mt-6 aspect-video rounded-3xl overflow-hidden bg-black ring-1 ring-white/5 shadow-2xl animate-in fade-in zoom-in-95 duration-500">
                  <iframe width="100%" height="100%" src={`https://www.youtube.com/embed/${track.youtubeId}?autoplay=1`} frameBorder="0" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen></iframe>
                </div>
              )}
            </div>
          ))}
        </div>
      </main>

      {currentTrack && (
        <div className="fixed bottom-6 left-6 right-6 bg-gray-900/80 backdrop-blur-2xl border border-white/10 rounded-[32px] p-4 flex items-center gap-6 z-50 shadow-[0_20px_50px_rgba(0,0,0,0.5)] max-w-2xl mx-auto animate-in slide-in-from-bottom-full duration-700">
          <img src={currentTrack.coverArt} className="w-14 h-14 rounded-2xl object-cover shadow-lg" alt="" />
          <div className="flex-1 min-w-0">
            <p className="font-black truncate text-sm tracking-tight">{currentTrack.title}</p>
            <p className="text-gray-400 truncate text-[10px] font-bold uppercase tracking-[0.2em]">{currentTrack.artist}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setIsPlaying(!isPlaying)} className="w-12 h-12 flex items-center justify-center bg-white text-black rounded-full hover:scale-110 active:scale-90 transition-all shadow-xl">
              {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
            </button>
            <button onClick={() => { setIsPlaying(false); setCurrentTrack(null); }} className="p-2 text-gray-500 hover:text-white transition-colors"><X className="w-6 h-6" /></button>
          </div>
          <audio ref={audioRef} src={currentTrack.previewUrl} onEnded={() => setIsPlaying(false)} className="hidden" />
        </div>
      )}
    </div>
  );
}
