import React, { useState, useEffect, useRef } from 'react';
import { Mic, Search, Music, Play, Pause, MonitorPlay, Disc3, Loader2, StopCircle, Waves, Key, Server, Lock, Percent, X } from 'lucide-react';

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

  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const timerRef = useRef(null);
  const audioRef = useRef(null);

  // Global Player Controls
  const togglePlay = (track) => {
    if (!track.previewUrl) return;

    if (currentTrack?.id === track.id) {
      setIsPlaying(!isPlaying);
    } else {
      setCurrentTrack(track);
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    if (audioRef.current && currentTrack) {
      if (isPlaying) {
        audioRef.current.play().catch(e => {
          console.error("Playback failed:", e);
          setIsPlaying(false);
        });
      } else {
        audioRef.current.pause();
      }
    }
  }, [currentTrack, isPlaying]);

  // Live Text Search using iTunes API
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
          youtubeId: null, // iTunes doesn't provide exact YT IDs
          spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(track.trackName + ' ' + track.artistName)}`,
          youtubeUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(track.trackName + ' ' + track.artistName)}`,
          appleUrl: track.trackViewUrl,
          score: null 
        })));
      }
    } catch (err) {
      setError("Failed to connect to the search service.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Generate HMAC-SHA1 signature
  const generateACRSignature = async (timestamp) => {
    const stringToSign = ['POST', '/v1/identify', acrAccessKey, 'audio', '1', timestamp].join('\n');
    const encoder = new TextEncoder();
    const keyData = encoder.encode(acrAccessSecret);
    const msgData = encoder.encode(stringToSign);

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    
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
      setOpenIframeId(null);

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
        
        const matches = data.metadata.music.slice(0, 5);
        
        const formattedResults = matches.map(track => {
          const artistName = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown Artist';
          const spotifyId = track.external_metadata?.spotify?.track?.id;
          const youtubeId = track.external_metadata?.youtube?.vid;

          return {
            id: track.acrid || Math.random().toString(),
            title: track.title,
            artist: artistName,
            album: track.album?.name || "Unknown Album",
            score: track.score, 
            coverArt: 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?w=300&h=300&fit=crop',
            previewUrl: '', 
            youtubeId: youtubeId, // We use this to embed the video!
            spotifyUrl: spotifyId ? `https://open.spotify.com/track/${spotifyId}` : `https://open.spotify.com/search/${encodeURIComponent(track.title + ' ' + artistName)}`,
            youtubeUrl: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(track.title + ' ' + artistName)}`,
            appleUrl: `https://music.apple.com/us/search?term=${encodeURIComponent(track.title + ' ' + artistName)}`
          };
        });

        setResults(formattedResults);

      } else {
        setError(data.status?.msg || "Could not identify the song. Try humming louder or longer.");
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
      <header className="p-6 border-b border-gray-800 flex items-center justify-center gap-3 relative z-10 bg-[#121212]">
        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-violet-600 to-pink-500 flex items-center justify-center shadow-lg shadow-pink-500/20">
          <Waves className="w-6 h-6 text-white" />
        </div>
        <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-pink-400">
          VIBIN
        </h1>
      </header>

      {/* Main Content Area (padding bottom prevents content hiding behind floating player) */}
      <main className={`max-w-3xl mx-auto p-6 flex flex-col items-center transition-all ${currentTrack ? 'pb-28' : ''}`}>
        
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
                For singing/humming, ensure your ACRCloud project is a <strong className="text-pink-400">"Humming & Singing Recognition"</strong> project, not a standard audio project.
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
                <p className="text-violet-400 font-medium animate-pulse">Analyzing Audio...</p>
              ) : (
                <p className="text-gray-400">Hum, sing, or play music to identify it.</p>
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
            <h2 className="text-xl font-bold mb-4">
              {activeTab === 'audio' ? 'Possible Matches' : 'Results'}
            </h2>
            {results.map((track, index) => (
              <div key={track.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex flex-col hover:border-gray-700 transition-colors relative overflow-hidden">
                
                {/* Score Badge */}
                {track.score && (
                  <div className="absolute top-0 right-0 bg-gradient-to-l from-pink-600 to-violet-600 px-3 py-1 rounded-bl-xl text-xs font-bold text-white flex items-center gap-1 shadow-lg z-10">
                    {track.score} <Percent className="w-3 h-3" /> Match
                  </div>
                )}

                {/* Rank Number */}
                {activeTab === 'audio' && (
                  <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-xs font-bold text-gray-400 z-10">
                    {index + 1}
                  </div>
                )}

                {/* Card Main Row */}
                <div className="flex flex-col sm:flex-row gap-4 items-center w-full">
                  
                  {/* Album Art & Inline Play Button */}
                  <div className="relative group w-24 h-24 shrink-0 mt-2 sm:mt-0 cursor-pointer" onClick={() => {
                      if (track.previewUrl) {
                        togglePlay(track);
                      } else if (track.youtubeId) {
                        setOpenIframeId(openIframeId === track.id ? null : track.id);
                      }
                  }}>
                    <img src={track.coverArt} alt={track.title} className="w-full h-full rounded-xl object-cover shadow-lg" />
                    {(track.previewUrl || track.youtubeId) && (
                      <div className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity rounded-xl ${
                          (currentTrack?.id === track.id && isPlaying) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}>
                        {(currentTrack?.id === track.id && isPlaying) ? (
                          <Pause className="w-8 h-8 text-white fill-white" />
                        ) : (
                          <Play className="w-8 h-8 text-white fill-white" />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Track Info */}
                  <div className="flex-1 text-center sm:text-left min-w-0 w-full mt-2 sm:mt-0">
                    <h3 className="text-lg font-bold text-white truncate pr-16">{track.title}</h3>
                    <p className="text-gray-400 truncate">{track.artist}</p>
                    <p className="text-gray-500 text-sm truncate mt-1">{track.album}</p>
                  </div>

                  {/* Links / Inline Toggles */}
                  <div className="flex sm:flex-col gap-2 shrink-0 w-full sm:w-auto justify-center mt-4 sm:mt-0 pt-4 sm:pt-0 border-t sm:border-t-0 border-gray-800">
                    <a href={track.spotifyUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-800 hover:bg-[#1DB954] hover:text-white text-gray-400 transition-colors tooltip-trigger" title="Search on Spotify">
                      <Music className="w-5 h-5" />
                    </a>
                    
                    {/* If we have a Youtube ID, open it inline instead of a new tab! */}
                    {track.youtubeId ? (
                      <button 
                        onClick={() => setOpenIframeId(openIframeId === track.id ? null : track.id)}
                        className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors ${openIframeId === track.id ? 'bg-[#FF0000] text-white' : 'bg-gray-800 hover:bg-[#FF0000] hover:text-white text-gray-400'}`} 
                        title="Play on YouTube Inline"
                      >
                        <MonitorPlay className="w-5 h-5" />
                      </button>
                    ) : (
                      <a href={track.youtubeUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-800 hover:bg-[#FF0000] hover:text-white text-gray-400 transition-colors" title="Search on YouTube">
                        <MonitorPlay className="w-5 h-5" />
                      </a>
                    )}

                    {track.appleUrl && (
                      <a href={track.appleUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-800 hover:bg-white hover:text-black text-gray-400 transition-colors" title="View on Apple Music">
                        <Disc3 className="w-5 h-5" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Inline YouTube Player (Expands if openIframeId matches) */}
                {openIframeId === track.id && track.youtubeId && (
                  <div className="w-full mt-6 rounded-xl overflow-hidden bg-black aspect-video animate-in slide-in-from-top-4">
                    <iframe
                      width="100%"
                      height="100%"
                      src={`https://www.youtube.com/embed/${track.youtubeId}?autoplay=1`}
                      title="YouTube video player"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    ></iframe>
                  </div>
                )}

              </div>
            ))}
          </div>
        )}
      </main>

      {/* Global Floating Audio Player (For Text Search Previews) */}
      {currentTrack && (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 p-4 flex items-center justify-center z-50 animate-in slide-in-from-bottom-full duration-300">
          <div className="flex items-center gap-4 max-w-xl w-full">
            <img src={currentTrack.coverArt} className="w-14 h-14 rounded-lg object-cover shadow-lg" alt="" />
            
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold truncate text-sm">{currentTrack.title}</p>
              <p className="text-gray-400 truncate text-xs">{currentTrack.artist}</p>
            </div>
            
            <button 
              onClick={() => setIsPlaying(!isPlaying)} 
              className="w-12 h-12 flex items-center justify-center bg-white text-black rounded-full hover:scale-105 transition-transform"
            >
              {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
            </button>
            
            <button 
              onClick={() => { setIsPlaying(false); setCurrentTrack(null); }} 
              className="p-2 text-gray-500 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          
          {/* Hidden Native Audio Element */}
          <audio
            ref={audioRef}
            src={currentTrack.previewUrl}
            onEnded={() => setIsPlaying(false)}
            className="hidden"
          />
        </div>
      )}
    </div>
  );
}
