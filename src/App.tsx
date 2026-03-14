/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, RotateCcw, ChevronRight, Crown, User, Cpu, Settings, X, Check, Brain, History, ArrowRight, Target } from 'lucide-react';

// --- Types ---

type Player = 'red' | 'black';

interface Piece {
  id: string;
  player: Player;
  isKing: boolean;
}

type Square = Piece | null;

interface Position {
  row: number;
  col: number;
}

interface Move {
  from: Position;
  to: Position;
  captured?: Position;
}

interface GameSettings {
  name: string;
  mandatoryJumps: boolean;
  flyingKings: boolean;
  menCaptureBackwards: boolean;
  maxCaptureRule: boolean;
  kingCapturePriority: boolean;
  midJumpPromotion: boolean;
  boardSize: number;
  vsAI: boolean;
  aiDifficulty: 'easy' | 'medium' | 'hard';
}

const RULE_PRESETS: Record<string, Partial<GameSettings>> = {
  standard: {
    name: 'American Standard',
    mandatoryJumps: true,
    flyingKings: false,
    menCaptureBackwards: false,
    maxCaptureRule: false,
    kingCapturePriority: false,
    midJumpPromotion: false,
    boardSize: 8
  },
  international: {
    name: 'International Style',
    mandatoryJumps: true,
    flyingKings: true,
    menCaptureBackwards: true,
    maxCaptureRule: true,
    kingCapturePriority: false,
    midJumpPromotion: false,
    boardSize: 8
  },
  brazilian: {
    name: 'Brazilian Checkers',
    mandatoryJumps: true,
    flyingKings: true,
    menCaptureBackwards: true,
    maxCaptureRule: true,
    kingCapturePriority: false,
    midJumpPromotion: false,
    boardSize: 8
  },
  czech: {
    name: 'Czech Checkers',
    mandatoryJumps: true,
    flyingKings: true,
    menCaptureBackwards: false,
    maxCaptureRule: false,
    kingCapturePriority: true,
    midJumpPromotion: false,
    boardSize: 8
  },
  russian: {
    name: 'Russian Checkers',
    mandatoryJumps: true,
    flyingKings: true,
    menCaptureBackwards: true,
    maxCaptureRule: false,
    kingCapturePriority: false,
    midJumpPromotion: true,
    boardSize: 8
  },
  casual: {
    name: 'Casual Play',
    mandatoryJumps: false,
    flyingKings: false,
    menCaptureBackwards: false,
    maxCaptureRule: false,
    kingCapturePriority: false,
    boardSize: 8
  }
};

// --- Constants ---

// --- Helper Functions ---

const getInitialPieceCount = (size: number) => ((size / 2) - 1) * (size / 2);

const createInitialBoard = (size: number): Square[][] => {
  const board: Square[][] = Array(size).fill(null).map(() => Array(size).fill(null));
  const rowsPerPlayer = (size / 2) - 1;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if ((row + col) % 2 !== 0) {
        if (row < rowsPerPlayer) {
          board[row][col] = { id: `black-${row}-${col}`, player: 'black', isKing: false };
        } else if (row >= size - rowsPerPlayer) {
          board[row][col] = { id: `red-${row}-${col}`, player: 'red', isKing: false };
        }
      }
    }
  }
  return board;
};

const isWithinBounds = (row: number, col: number, size: number) => 
  row >= 0 && row < size && col >= 0 && col < size;

interface HistoryEntry {
  id: string;
  player: Player;
  from: Position;
  to: Position;
  captured?: { row: number; col: number; player: Player; isKing: boolean };
  isPromotion: boolean;
  timestamp: number;
}

export default function App() {
  const [settings, setSettings] = useState<GameSettings>({
    ...RULE_PRESETS.standard as GameSettings,
    vsAI: true,
    aiDifficulty: 'medium'
  });
  const [board, setBoard] = useState<Square[][]>(createInitialBoard(settings.boardSize));
  const [currentPlayer, setCurrentPlayer] = useState<Player>('red');
  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [validMoves, setValidMoves] = useState<Move[]>([]);
  const [winner, setWinner] = useState<Player | 'draw' | null>(null);
  const [mustCapture, setMustCapture] = useState<boolean>(false);
  const [mustJumpFrom, setMustJumpFrom] = useState<Position | null>(null);
  const [score, setScore] = useState({ red: 12, black: 12 });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // --- Logic ---

  const addMoveToHistory = useCallback((move: Move, currentBoard: Square[][], isPromotion: boolean) => {
    const piece = currentBoard[move.from.row][move.from.col];
    if (!piece) return;

    let capturedPiece = null;
    if (move.captured) {
      const target = currentBoard[move.captured.row][move.captured.col];
      if (target) {
        capturedPiece = {
          row: move.captured.row,
          col: move.captured.col,
          player: target.player,
          isKing: target.isKing
        };
      }
    }

    const entry: HistoryEntry = {
      id: Math.random().toString(36).substr(2, 9),
      player: piece.player,
      from: move.from,
      to: move.to,
      captured: capturedPiece || undefined,
      isPromotion,
      timestamp: Date.now()
    };

    setHistory(prev => [entry, ...prev]);
  }, []);

  const getCaptureSequences = useCallback((
    row: number,
    col: number,
    currentBoard: Square[][],
    visited: Set<string> = new Set()
  ): Move[][] => {
    const piece = currentBoard[row][col];
    if (!piece) return [];

    const sequences: Move[][] = [];
    const directions = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const forwardDirections = piece.player === 'red' ? [[-1, 1], [-1, -1]] : [[1, 1], [1, -1]];
    const captureDirs = (piece.isKing || settings.menCaptureBackwards) ? directions : forwardDirections;

    for (const [dr, dc] of captureDirs) {
      if (piece.isKing && settings.flyingKings) {
        let r = row + dr;
        let c = col + dc;
        let opponentPos: Position | null = null;

        while (isWithinBounds(r, c, settings.boardSize)) {
          const target = currentBoard[r][c];
          const posKey = `${r}-${c}`;
          
          if (!opponentPos) {
            if (target) {
              if (target.player !== piece.player && !visited.has(posKey)) {
                opponentPos = { row: r, col: c };
              } else {
                break;
              }
            }
          } else {
            if (target) break;
            
            const move: Move = { from: { row, col }, to: { row: r, col: c }, captured: opponentPos };
            const nextBoard = currentBoard.map(row => [...row]);
            const nextPiece = { ...piece };
            if (settings.midJumpPromotion && !nextPiece.isKing) {
              if ((nextPiece.player === 'red' && r === 0) || (nextPiece.player === 'black' && r === settings.boardSize - 1)) {
                nextPiece.isKing = true;
              }
            }
            nextBoard[r][c] = nextPiece;
            nextBoard[row][col] = null;
            const nextVisited = new Set(visited);
            nextVisited.add(`${opponentPos.row}-${opponentPos.col}`);
            
            const subSequences = getCaptureSequences(r, c, nextBoard, nextVisited);
            if (subSequences.length > 0) {
              for (const sub of subSequences) {
                sequences.push([move, ...sub]);
              }
            } else {
              sequences.push([move]);
            }
          }
          r += dr;
          c += dc;
        }
      } else {
        const midR = row + dr;
        const midC = col + dc;
        const endR = row + dr * 2;
        const endC = col + dc * 2;
        const posKey = `${midR}-${midC}`;

        if (isWithinBounds(endR, endC, settings.boardSize)) {
          const midPiece = currentBoard[midR][midC];
          const endPiece = currentBoard[endR][endC];
          if (midPiece && midPiece.player !== piece.player && !endPiece && !visited.has(posKey)) {
            const move: Move = { from: { row, col }, to: { row: endR, col: endC }, captured: { row: midR, col: midC } };
            const nextBoard = currentBoard.map(row => [...row]);
            const nextPiece = { ...piece };
            if (settings.midJumpPromotion && !nextPiece.isKing) {
              if ((nextPiece.player === 'red' && endR === 0) || (nextPiece.player === 'black' && endR === settings.boardSize - 1)) {
                nextPiece.isKing = true;
              }
            }
            nextBoard[endR][endC] = nextPiece;
            nextBoard[row][col] = null;
            const nextVisited = new Set(visited);
            nextVisited.add(posKey);
            
            const subSequences = getCaptureSequences(endR, endC, nextBoard, nextVisited);
            if (subSequences.length > 0) {
              for (const sub of subSequences) {
                sequences.push([move, ...sub]);
              }
            } else {
              sequences.push([move]);
            }
          }
        }
      }
    }
    return sequences;
  }, [settings]);

  const getValidMovesForPiece = useCallback((row: number, col: number, currentBoard: Square[][], forceCaptureOnly: boolean = false): Move[] => {
    const piece = currentBoard[row][col];
    if (!piece) return [];

    const captureSequences = getCaptureSequences(row, col, currentBoard);
    if (captureSequences.length > 0) {
      return captureSequences.map(seq => seq[0]);
    }

    if (forceCaptureOnly) return [];

    const moves: Move[] = [];
    const directions = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const forwardDirections = piece.player === 'red' ? [[-1, 1], [-1, -1]] : [[1, 1], [1, -1]];
    const moveDirs = piece.isKing ? directions : forwardDirections;

    for (const [dr, dc] of moveDirs) {
      if (piece.isKing && settings.flyingKings) {
        let r = row + dr;
        let c = col + dc;
        while (isWithinBounds(r, c, settings.boardSize) && !currentBoard[r][c]) {
          moves.push({ from: { row, col }, to: { row: r, col: c } });
          r += dr;
          c += dc;
        }
      } else {
        const endR = row + dr;
        const endC = col + dc;
        if (isWithinBounds(endR, endC, settings.boardSize) && !currentBoard[endR][endC]) {
          moves.push({ from: { row, col }, to: { row: endR, col: endC } });
        }
      }
    }

    return moves;
  }, [settings, getCaptureSequences]);

  const getAllValidMoves = useCallback((player: Player, currentBoard: Square[][], restrictedPos: Position | null = null): Move[] => {
    let allCaptureSequences: Move[][] = [];
    let regularMoves: Move[] = [];

    const checkRows = restrictedPos ? [restrictedPos.row] : Array.from({ length: settings.boardSize }, (_, i) => i);
    const checkCols = restrictedPos ? [restrictedPos.col] : Array.from({ length: settings.boardSize }, (_, i) => i);

    for (const r of checkRows) {
      for (const c of (restrictedPos ? checkCols : Array.from({ length: settings.boardSize }, (_, i) => i))) {
        const piece = currentBoard[r][c];
        if (piece && piece.player === player) {
          const captures = getCaptureSequences(r, c, currentBoard);
          allCaptureSequences = [...allCaptureSequences, ...captures];
          
          if (captures.length === 0 && !restrictedPos) {
            regularMoves = [...regularMoves, ...getValidMovesForPiece(r, c, currentBoard)];
          }
        }
      }
    }

    if (allCaptureSequences.length > 0) {
      let validSequences = allCaptureSequences;

      // Rule: King Capture Priority (Czech)
      if (settings.kingCapturePriority) {
        const kingCaptures = allCaptureSequences.filter(seq => {
          const piece = currentBoard[seq[0].from.row][seq[0].from.col];
          return piece?.isKing;
        });
        if (kingCaptures.length > 0) {
          validSequences = kingCaptures;
        }
      }

      // Rule: Maximum Capture (Brazilian/International)
      if (settings.maxCaptureRule) {
        const maxLength = Math.max(...validSequences.map(seq => seq.length));
        validSequences = validSequences.filter(seq => seq.length === maxLength);
      }

      // Return unique first moves of valid sequences
      const uniqueMoves: Move[] = [];
      const seen = new Set<string>();
      for (const seq of validSequences) {
        const move = seq[0];
        const key = `${move.from.row}-${move.from.col}-${move.to.row}-${move.to.col}`;
        if (!seen.has(key)) {
          uniqueMoves.push(move);
          seen.add(key);
        }
      }
      return uniqueMoves;
    }

    return regularMoves;
  }, [getValidMovesForPiece, getCaptureSequences, settings]);

  const executeMove = useCallback((move: Move, currentBoard: Square[][]) => {
    const newBoard = currentBoard.map(row => [...row]);
    const piece = { ...newBoard[move.from.row][move.from.col]! };
    const wasKing = piece.isKing;

    newBoard[move.to.row][move.to.col] = piece;
    newBoard[move.from.row][move.from.col] = null;

    let captured = false;
    if (move.captured) {
      newBoard[move.captured.row][move.captured.col] = null;
      captured = true;
    }

    // Promotion logic
    const isPromotionRow = (piece.player === 'red' && move.to.row === 0) || (piece.player === 'black' && move.to.row === settings.boardSize - 1);
    
    if (isPromotionRow) {
      if (!captured || settings.midJumpPromotion) {
        piece.isKing = true;
      }
    }

    let canContinue = false;
    if (captured) {
      // If midJumpPromotion is false, and we just reached the promotion row, we MUST stop.
      // In International/Brazilian, if a man reaches the king row during a jump but must continue jumping,
      // it does NOT become a king and does NOT stop. It only becomes a king if it STOPS there.
      // In Russian, it becomes a king and CONTINUES.
      
      const nextCaptures = getCaptureSequences(move.to.row, move.to.col, newBoard);
      
      if (nextCaptures.length > 0) {
        if (isPromotionRow && !settings.midJumpPromotion) {
          // Reached king row but can't continue as king and must stop to promote
          canContinue = false;
        } else {
          canContinue = true;
        }
      }
    }

    // Final promotion if turn ends on promotion row
    if (!canContinue && isPromotionRow) {
      piece.isKing = true;
    }

    const isPromotion = !wasKing && piece.isKing;

    return { newBoard, canContinue, captured, isPromotion };
  }, [getCaptureSequences, settings.boardSize, settings.midJumpPromotion]);

  // --- AI Logic ---

  const evaluateBoard = (currentBoard: Square[][]): number => {
    let score = 0;
    const size = settings.boardSize;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const piece = currentBoard[r][c];
        if (piece) {
          const isBlack = piece.player === 'black';
          const multiplier = isBlack ? 1 : -1;
          
          // 1. Piece Value
          let value = piece.isKing ? 10 : 5;

          // 2. Position Bonus (Center control and advancement)
          // Center squares are more valuable
          const isCenter = (r >= 2 && r <= size - 3 && c >= 2 && c <= size - 3);
          if (isCenter) value += 0.5;

          // Advancement bonus for men
          if (!piece.isKing) {
            const advancement = isBlack ? r : (size - 1 - r);
            value += (advancement / (size - 1)) * 1.5;
          }

          // 3. Protection Bonus
          // Check if piece is protected by pieces behind it
          const backDir = isBlack ? -1 : 1;
          const protectR = r + backDir;
          if (isWithinBounds(protectR, c - 1, size) && currentBoard[protectR][c - 1]?.player === piece.player) value += 0.2;
          if (isWithinBounds(protectR, c + 1, size) && currentBoard[protectR][c + 1]?.player === piece.player) value += 0.2;

          // 4. Back Row Protection
          if (!piece.isKing && (isBlack ? r === 0 : r === size - 1)) {
            value += 1.0;
          }

          score += value * multiplier;
        }
      }
    }

    // 5. Mobility (Number of valid moves)
    const blackMoves = getAllValidMoves('black', currentBoard).length;
    const redMoves = getAllValidMoves('red', currentBoard).length;
    score += (blackMoves - redMoves) * 0.1;

    return score;
  };

  const minimax = (currentBoard: Square[][], depth: number, alpha: number, beta: number, isMaximizing: boolean, restrictedPos: Position | null = null): number => {
    if (depth === 0) return evaluateBoard(currentBoard);

    const player: Player = isMaximizing ? 'black' : 'red';
    const moves = getAllValidMoves(player, currentBoard, restrictedPos);

    if (moves.length === 0) {
      if (restrictedPos) {
        // If we were in a multi-jump but can't continue, it's the other player's turn
        return minimax(currentBoard, depth - 1, alpha, beta, !isMaximizing, null);
      }
      return isMaximizing ? -1000 : 1000;
    }

    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const move of moves) {
        const { newBoard, canContinue } = executeMove(move, currentBoard);
        const evaluation = minimax(newBoard, canContinue ? depth : depth - 1, alpha, beta, canContinue ? true : false, canContinue ? move.to : null);
        maxEval = Math.max(maxEval, evaluation);
        alpha = Math.max(alpha, evaluation);
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const move of moves) {
        const { newBoard, canContinue } = executeMove(move, currentBoard);
        const evaluation = minimax(newBoard, canContinue ? depth : depth - 1, alpha, beta, canContinue ? false : true, canContinue ? move.to : null);
        minEval = Math.min(minEval, evaluation);
        beta = Math.min(beta, evaluation);
        if (beta <= alpha) break;
      }
      return minEval;
    }
  };

  const getBestMove = (currentBoard: Square[][], player: Player, restrictedPos: Position | null = null): Move | null => {
    const moves = getAllValidMoves(player, currentBoard, restrictedPos);
    if (moves.length === 0) return null;

    let bestMove = null;
    let bestValue = player === 'black' ? -Infinity : Infinity;

    const depth = settings.aiDifficulty === 'easy' ? 2 : settings.aiDifficulty === 'medium' ? 4 : 6;

    for (const move of moves) {
      const { newBoard, canContinue } = executeMove(move, currentBoard);
      // If we can continue, we should ideally evaluate the next step of the multi-jump
      // But for simplicity, we'll just pass the canContinue flag to minimax
      const boardValue = minimax(newBoard, depth - 1, -Infinity, Infinity, player === 'black' ? canContinue : !canContinue, canContinue ? move.to : null);
      
      if (player === 'black') {
        if (boardValue > bestValue) {
          bestValue = boardValue;
          bestMove = move;
        }
      } else {
        if (boardValue < bestValue) {
          bestValue = boardValue;
          bestMove = move;
        }
      }
    }
    return bestMove;
  };

  // --- Handlers ---

  const handleSquareClick = (row: number, col: number) => {
    if (winner || isThinking) return;
    if (settings.vsAI && currentPlayer === 'black') return;

    const piece = board[row][col];

    if (piece && piece.player === currentPlayer) {
      if (mustCapture && selectedPos && (selectedPos.row !== row || selectedPos.col !== col)) return;
      const allMoves = getAllValidMoves(currentPlayer, board);
      const pieceMoves = allMoves.filter(m => m.from.row === row && m.from.col === col);
      setSelectedPos({ row, col });
      setValidMoves(pieceMoves);
      return;
    }

    const move = validMoves.find(m => m.to.row === row && m.to.col === col);
    if (move) {
      const { newBoard, canContinue, captured, isPromotion } = executeMove(move, board);
      addMoveToHistory(move, board, isPromotion);
      setBoard(newBoard);
      if (captured) {
        setScore(prev => ({
          ...prev,
          [currentPlayer === 'red' ? 'black' : 'red']: prev[currentPlayer === 'red' ? 'black' : 'red'] - 1
        }));
      }

      if (canContinue) {
        setSelectedPos(move.to);
        setMustJumpFrom(move.to);
        
        let nextMoves = getValidMovesForPiece(move.to.row, move.to.col, newBoard, true);
        
        // Strictly enforce max capture rule during multi-jumps
        if (settings.maxCaptureRule) {
          const sequences = getCaptureSequences(move.to.row, move.to.col, newBoard);
          const maxLength = Math.max(...sequences.map(seq => seq.length));
          const validSequences = sequences.filter(seq => seq.length === maxLength);
          const validFirstMoves = validSequences.map(seq => seq[0]);
          
          nextMoves = nextMoves.filter(m => 
            validFirstMoves.some(vm => vm.to.row === m.to.row && vm.to.col === m.to.col)
          );
        }
        
        setValidMoves(nextMoves);
        setMustCapture(true);
      } else {
        setSelectedPos(null);
        setValidMoves([]);
        setMustCapture(false);
        setMustJumpFrom(null);
        setCurrentPlayer(currentPlayer === 'red' ? 'black' : 'red');
      }
    } else if (!mustCapture) {
      setSelectedPos(null);
      setValidMoves([]);
    }
  };

  const resetGame = () => {
    setBoard(createInitialBoard(settings.boardSize));
    setCurrentPlayer('red');
    setSelectedPos(null);
    setValidMoves([]);
    setWinner(null);
    setMustCapture(false);
    setMustJumpFrom(null);
    const pieceCount = getInitialPieceCount(settings.boardSize);
    setScore({ red: pieceCount, black: pieceCount });
    setIsThinking(false);
    setHistory([]);
  };

  const applySettings = (newSettings: GameSettings) => {
    setSettings(newSettings);
    setIsSettingsOpen(false);
    const newBoard = createInitialBoard(newSettings.boardSize);
    setBoard(newBoard);
    setCurrentPlayer('red');
    setSelectedPos(null);
    setValidMoves([]);
    setWinner(null);
    const pieceCount = getInitialPieceCount(newSettings.boardSize);
    setScore({ red: pieceCount, black: pieceCount });
    setIsThinking(false);
    setHistory([]);
  };

  // AI Turn Effect
  useEffect(() => {
    if (settings.vsAI && currentPlayer === 'black' && !winner) {
      setIsThinking(true);
      const timer = setTimeout(() => {
        const move = getBestMove(board, 'black', mustJumpFrom);
        if (move) {
          const { newBoard, canContinue, captured, isPromotion } = executeMove(move, board);
          addMoveToHistory(move, board, isPromotion);
          setBoard(newBoard);
          if (captured) {
            setScore(prev => ({ ...prev, red: prev.red - 1 }));
          }

          if (canContinue) {
            setMustJumpFrom(move.to);
            // AI continues its turn (multi-jump)
          } else {
            setMustJumpFrom(null);
            setCurrentPlayer('red');
          }
        } else {
          // Should not happen if getAllValidMoves is correct, but safety first
          setMustJumpFrom(null);
          setCurrentPlayer('red');
        }
        setIsThinking(false);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [currentPlayer, board, winner, settings.vsAI, executeMove, mustJumpFrom]);

  // Win condition
  useEffect(() => {
    const nextMoves = getAllValidMoves(currentPlayer, board);
    if (nextMoves.length === 0) {
      setWinner(currentPlayer === 'red' ? 'black' : 'red');
    }
  }, [currentPlayer, board, getAllValidMoves]);

  return (
    <div className="min-h-screen text-white font-sans flex flex-col items-center justify-center p-4 md:p-8 relative overflow-hidden">
      {/* Atmospheric Background Decorations */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-red-600/10 rounded-full blur-[120px] animate-float" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-white/5 rounded-full blur-[120px] animate-float" style={{ animationDelay: '-3s' }} />
      <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] bg-red-500/5 rounded-full blur-[100px] animate-float" style={{ animationDelay: '-5s' }} />
      <div className="absolute bottom-[30%] left-[5%] w-[20%] h-[20%] bg-white/5 rounded-full blur-[80px] animate-float" style={{ animationDelay: '-7s' }} />
      
      {/* Header Section */}
      <div className="w-full max-w-4xl flex flex-col md:flex-row items-center justify-between mb-12 gap-8 z-10">
        <div className="flex flex-col">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            className="animate-shimmer rounded-2xl px-4 py-2 -ml-4"
          >
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-2 flex items-center gap-3">
              GRANDMASTER <span className="text-red-500 glow-red">CHECKERS</span>
            </h1>
          </motion.div>
          <div className="flex items-center gap-3 px-1">
            <p className="text-sm text-white/40 font-bold uppercase tracking-[0.4em]">{settings.name}</p>
            <div className="w-1.5 h-1.5 rounded-full bg-red-500/50" />
            <p className="text-[10px] text-white/30 font-black uppercase tracking-widest">
              {settings.vsAI ? `Neural Engine: ${settings.aiDifficulty}` : 'Multiplayer: Local'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className={`flex items-center gap-4 px-6 py-3 rounded-2xl marvelous-glass transition-all duration-700 ${currentPlayer === 'red' ? 'ring-2 ring-red-500 bg-red-500/10 glow-red' : 'opacity-60'}`}>
            <div className="w-4 h-4 rounded-full bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.8)]" />
            <div className="flex flex-col">
              <span className="font-black text-3xl leading-none tracking-tighter">{score.red}</span>
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Red</span>
            </div>
          </div>
          <div className={`flex items-center gap-4 px-6 py-3 rounded-2xl marvelous-glass transition-all duration-700 ${currentPlayer === 'black' ? 'ring-2 ring-white/50 bg-white/5 glow-white' : 'opacity-60'}`}>
            <div className="w-4 h-4 rounded-full bg-white shadow-[0_0_20px_rgba(255,255,255,0.6)]" />
            <div className="flex flex-col">
              <span className="font-black text-3xl leading-none tracking-tighter">{score.black}</span>
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Black</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-4 rounded-2xl marvelous-glass hover:bg-white/10 transition-all active:scale-90 group"
              title="Game Settings"
            >
              <Settings size={24} className="text-white/60 group-hover:text-white group-hover:rotate-90 transition-transform duration-700" />
            </button>
            <button 
              onClick={resetGame}
              className="p-4 rounded-2xl marvelous-glass hover:bg-white/10 transition-all active:scale-90 group"
              title="Reset Game"
            >
              <RotateCcw size={24} className="text-white/60 group-hover:text-white group-hover:-rotate-180 transition-transform duration-700" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Game Area & Chronicle */}
      <div className="flex flex-col lg:flex-row gap-12 items-start justify-center w-full max-w-7xl z-10">
        <div className="relative group">
          <div className="absolute -inset-8 bg-red-600/10 rounded-[3rem] blur-3xl -z-10 group-hover:bg-red-600/20 transition-colors duration-700" />
        
        <div className="marvelous-glass p-8 rounded-[3rem] shadow-2xl relative">
          <div className="absolute inset-0 board-texture opacity-20 rounded-[3rem] pointer-events-none" />
          <div 
            className="grid border-[12px] border-white/5 rounded-3xl overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.8)] relative z-10"
            style={{ gridTemplateColumns: `repeat(${settings.boardSize}, minmax(0, 1fr))` }}
          >
            {board.map((row, rIdx) => 
              row.map((square, cIdx) => {
                const isDark = (rIdx + cIdx) % 2 !== 0;
                const isSelected = selectedPos?.row === rIdx && selectedPos?.col === cIdx;
                const isValidMove = validMoves.some(m => m.to.row === rIdx && m.to.col === cIdx);

                return (
                  <div
                    key={`${rIdx}-${cIdx}`}
                    onClick={() => handleSquareClick(rIdx, cIdx)}
                    className={`
                      relative w-12 h-12 sm:w-16 sm:h-16 md:w-24 md:h-24 flex items-center justify-center cursor-pointer
                      ${isDark ? 'bg-black/40' : 'bg-white/[0.07]'}
                      hover:bg-white/10 transition-all duration-300
                      ${isDark ? 'shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]' : 'shadow-[inset_0_0_20px_rgba(255,255,255,0.02)]'}
                    `}
                  >
                    {isValidMove && (
                      <motion.div 
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="absolute inset-0 bg-emerald-500/10 border-4 border-emerald-500/30 z-10 pointer-events-none"
                      />
                    )}

                    {isSelected && (
                      <div className="absolute inset-0 bg-blue-500/10 border-4 border-blue-500/30 z-10 pointer-events-none" />
                    )}

                    <AnimatePresence mode="popLayout">
                      {square && (
                        <motion.div
                          key={square.id}
                          layoutId={square.id}
                          initial={{ scale: 0.5, opacity: 0, y: -20 }}
                          animate={{ scale: 1, opacity: 1, y: 0 }}
                          exit={{ scale: 0.5, opacity: 0, y: 20 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                          className={`
                            relative w-[85%] h-[85%] rounded-full flex items-center justify-center
                            ${square.player === 'red' 
                              ? 'bg-gradient-to-br from-red-400 via-red-600 to-red-800 piece-shadow-red' 
                              : 'bg-gradient-to-br from-neutral-600 via-neutral-800 to-black piece-shadow-black'}
                            z-20
                          `}
                        >
                          <div className="absolute inset-1 rounded-full border-t border-white/30 pointer-events-none" />
                          <div className="absolute inset-2 rounded-full border border-black/20 pointer-events-none" />
                          {square.isKing && (
                            <motion.div 
                              initial={{ rotate: -45, scale: 0 }} 
                              animate={{ rotate: 0, scale: 1 }}
                              className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                            >
                              <Crown size={28} className="text-yellow-400" fill="currentColor" />
                            </motion.div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Thinking Overlay */}
        <AnimatePresence>
          {isThinking && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="absolute top-8 right-8 z-40 bg-white/10 backdrop-blur-xl px-6 py-3 rounded-2xl border border-white/10 flex items-center gap-3 shadow-2xl"
            >
              <div className="relative">
                <Brain size={20} className="text-red-500 animate-pulse" />
                <div className="absolute inset-0 bg-red-500 blur-md opacity-50 animate-pulse" />
              </div>
              <span className="text-xs font-black uppercase tracking-[0.2em] text-white/80">Engine Thinking</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Winner Overlay */}
        <AnimatePresence>
          {winner && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-50 flex items-center justify-center rounded-[2.5rem] bg-black/40 backdrop-blur-md"
            >
              <motion.div 
                initial={{ scale: 0.8, y: 40 }}
                animate={{ scale: 1, y: 0 }}
                className="marvelous-glass p-12 rounded-[3rem] text-center max-w-sm"
              >
                <div className="w-24 h-24 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-6 relative">
                  <Trophy size={48} className="text-yellow-500" />
                  <div className="absolute inset-0 bg-yellow-500 blur-2xl opacity-20 animate-pulse" />
                </div>
                <h2 className="text-4xl font-black mb-3 tracking-tighter">
                  {winner === 'draw' ? "STALEMATE" : `${winner.toUpperCase()} VICTORIOUS`}
                </h2>
                <p className="text-white/40 mb-8 font-bold uppercase tracking-widest text-xs">
                  {settings.vsAI && winner === 'black' ? "The machine has prevailed." : "A display of pure strategic dominance."}
                </p>
                <button 
                  onClick={resetGame}
                  className="w-full py-5 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-red-500 transition-all active:scale-95 flex items-center justify-center gap-3 shadow-[0_0_30px_rgba(220,38,38,0.4)]"
                >
                  <RotateCcw size={20} />
                  Rematch
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Chronicle (Move History) */}
      <div className="w-full lg:w-80 flex flex-col gap-6 self-stretch">
        <div className="marvelous-glass p-8 rounded-[3rem] flex flex-col h-full max-h-[600px] lg:max-h-[768px]">
          <div className="flex items-center gap-4 mb-8">
            <div className="p-3 bg-white/5 rounded-2xl border border-white/10">
              <History size={24} className="text-white/60" />
            </div>
            <h3 className="font-black text-xl tracking-tighter uppercase">Chronicle</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
            {history.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-white/10 gap-4 py-20">
                <Target size={64} strokeWidth={1} />
                <p className="text-[10px] font-black uppercase tracking-[0.4em]">No moves recorded</p>
              </div>
            ) : (
              history.map((entry, idx) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="p-5 rounded-3xl bg-white/[0.02] border border-white/5 flex items-center justify-between group hover:bg-white/[0.05] transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-2.5 h-2.5 rounded-full ${entry.player === 'red' ? 'bg-red-500 glow-red' : 'bg-white glow-white'}`} />
                    <div className="flex flex-col">
                      <div className="flex items-center gap-3 text-sm font-black tracking-widest text-white/80">
                        <span>{String.fromCharCode(65 + entry.from.col)}{settings.boardSize - entry.from.row}</span>
                        <ArrowRight size={14} className="text-white/20" />
                        <span>{String.fromCharCode(65 + entry.to.col)}{settings.boardSize - entry.to.row}</span>
                      </div>
                      <div className="flex gap-2 mt-2">
                        {entry.captured && (
                          <span className="text-[9px] font-black uppercase tracking-widest text-red-500/60 flex items-center gap-1.5 px-2 py-0.5 bg-red-500/5 rounded-lg">
                            <X size={10} /> Captured
                          </span>
                        )}
                        {entry.isPromotion && (
                          <span className="text-[9px] font-black uppercase tracking-widest text-yellow-500/60 flex items-center gap-1.5 px-2 py-0.5 bg-yellow-500/5 rounded-lg">
                            <Crown size={10} /> Kinged
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-white/10 group-hover:text-white/30 transition-colors">
                    #{history.length - idx}
                  </span>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
        <AnimatePresence>
          {isSettingsOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 60 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 60 }}
                className="marvelous-glass w-full max-w-xl rounded-[4rem] overflow-hidden border-white/20 shadow-[0_0_100px_rgba(0,0,0,1)]"
              >
                <div className="p-10 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
                  <h2 className="text-3xl font-black flex items-center gap-4 tracking-tighter">
                    <Settings size={32} className="text-red-500 glow-red" />
                    SYSTEM CONFIG
                  </h2>
                  <button onClick={() => setIsSettingsOpen(false)} className="p-4 hover:bg-white/10 rounded-[2rem] transition-all active:scale-90">
                    <X size={32} />
                  </button>
                </div>

                <div className="p-10 space-y-10 max-h-[60vh] overflow-y-auto custom-scrollbar">
                  {/* AI Toggle */}
                  <div className="space-y-5">
                    <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-white/30 px-2">Select Opponent</h3>
                    <div className="flex gap-4">
                      <button 
                        onClick={() => setSettings(s => ({ ...s, vsAI: false }))}
                        className={`flex-1 p-8 rounded-[2.5rem] border-2 transition-all flex flex-col items-center gap-4 ${!settings.vsAI ? 'border-red-500 bg-red-500/10 text-red-500 glow-red' : 'border-white/5 text-white/40 hover:border-white/10 hover:bg-white/5'}`}
                      >
                        <User size={28} />
                        <span className="text-sm font-black uppercase tracking-widest">Local PvP</span>
                      </button>
                      <button 
                        onClick={() => setSettings(s => ({ ...s, vsAI: true }))}
                        className={`flex-1 p-8 rounded-[2.5rem] border-2 transition-all flex flex-col items-center gap-4 ${settings.vsAI ? 'border-red-500 bg-red-500/10 text-red-500 glow-red' : 'border-white/5 text-white/40 hover:border-white/10 hover:bg-white/5'}`}
                      >
                        <Brain size={28} />
                        <span className="text-sm font-black uppercase tracking-widest">Neural Engine</span>
                      </button>
                    </div>
                  </div>

                  {/* AI Difficulty */}
                  {settings.vsAI && (
                    <div className="space-y-5">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-white/30 px-2">Engine Complexity</h3>
                      <div className="flex gap-3">
                        {(['easy', 'medium', 'hard'] as const).map(diff => (
                          <button 
                            key={diff}
                            onClick={() => setSettings(s => ({ ...s, aiDifficulty: diff }))}
                            className={`flex-1 p-4 rounded-2xl border-2 text-[10px] font-black uppercase tracking-[0.2em] transition-all ${settings.aiDifficulty === diff ? 'border-red-500 bg-red-500/10 text-red-500' : 'border-white/5 text-white/30 hover:border-white/10'}`}
                          >
                            {diff}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Board Size */}
                  <div className="space-y-5">
                    <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-white/30 px-2">Board Dimensions</h3>
                    <div className="flex gap-3">
                      {[6, 8, 10].map(size => (
                        <button 
                          key={size}
                          onClick={() => setSettings(s => ({ ...s, boardSize: size }))}
                          className={`flex-1 p-4 rounded-2xl border-2 text-[10px] font-black uppercase tracking-[0.2em] transition-all ${settings.boardSize === size ? 'border-red-500 bg-red-500/10 text-red-500' : 'border-white/5 text-white/30 hover:border-white/10'}`}
                        >
                          {size}x{size}
                        </button>
                      ))}
                    </div>
                    <p className="text-[9px] text-white/20 px-2 uppercase tracking-widest font-bold">
                      Changing size will reset the current match
                    </p>
                  </div>

                  {/* Rule Presets */}
                  <div className="space-y-5">
                    <h3 className="text-[11px] font-black uppercase tracking-[0.4em] text-white/30 px-2">Tactical Rulesets</h3>
                    <div className="grid grid-cols-1 gap-4">
                      {Object.entries(RULE_PRESETS).map(([key, preset]) => (
                        <button
                          key={key}
                          onClick={() => applySettings({ ...settings, ...preset as GameSettings })}
                          className={`
                            w-full p-8 rounded-[3rem] border-2 text-left transition-all group relative overflow-hidden
                            ${settings.name === preset.name 
                              ? 'border-red-500 bg-red-500/10' 
                              : 'border-white/5 hover:border-white/10 hover:bg-white/5'}
                          `}
                        >
                          <div className="flex items-center justify-between mb-4 relative z-10">
                            <span className={`text-xl font-black tracking-tighter ${settings.name === preset.name ? 'text-red-500' : 'text-white/80'}`}>
                              {preset.name.toUpperCase()}
                            </span>
                            {settings.name === preset.name && <Check size={24} className="text-red-500" />}
                          </div>
                          <div className="flex flex-wrap gap-3 relative z-10">
                            <span className="text-[10px] font-black uppercase tracking-widest px-4 py-1.5 bg-black/40 border border-white/10 rounded-xl text-white/40">
                              {preset.mandatoryJumps ? 'Mandatory' : 'Optional'}
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-widest px-4 py-1.5 bg-black/40 border border-white/10 rounded-xl text-white/40">
                              {preset.flyingKings ? 'Flying Kings' : 'Standard'}
                            </span>
                            {preset.maxCaptureRule && (
                              <span className="text-[10px] font-black uppercase tracking-widest px-4 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-500">
                                Max Capture
                              </span>
                            )}
                            {preset.midJumpPromotion && (
                              <span className="text-[10px] font-black uppercase tracking-widest px-4 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-xl text-purple-500">
                                Mid-Jump
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="p-10 bg-black/40 flex gap-5">
                  <button 
                    onClick={() => setIsSettingsOpen(false)}
                    className="flex-1 py-6 bg-red-600 hover:bg-red-500 text-white font-black uppercase tracking-[0.2em] rounded-[2rem] transition-all active:scale-95 shadow-[0_0_30px_rgba(220,38,38,0.3)]"
                  >
                    DEPLOY CONFIG
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      {/* Footer Info */}
      <div className="mt-12 w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-6 z-10">
        <div className="marvelous-glass p-8 rounded-[2.5rem] border-white/5">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-red-500/10 rounded-2xl border border-red-500/20">
              <User size={24} className="text-red-500 glow-red" />
            </div>
            <h3 className="font-black text-lg tracking-tighter uppercase">Turn Status</h3>
          </div>
          <p className="text-sm text-white/40 leading-relaxed font-medium">
            It is currently <span className={`font-black ${currentPlayer === 'red' ? 'text-red-500' : 'text-white'}`}>{currentPlayer.toUpperCase()}'s</span> turn. 
            {isThinking && " AI is calculating its next move..."}
          </p>
        </div>

        <div className="marvelous-glass p-8 rounded-[2.5rem] border-white/5">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
              <ChevronRight size={24} className="text-emerald-500" />
            </div>
            <h3 className="font-black text-lg tracking-tighter uppercase">Rule Details</h3>
          </div>
          <ul className="text-[10px] text-white/40 space-y-2 font-black uppercase tracking-widest">
            <li className="flex justify-between"><span>Jumps:</span> <span className="text-white/60">{settings.mandatoryJumps ? 'Mandatory' : 'Optional'}</span></li>
            <li className="flex justify-between"><span>Kings:</span> <span className="text-white/60">{settings.flyingKings ? 'Flying' : 'Standard'}</span></li>
            <li className="flex justify-between"><span>Opponent:</span> <span className="text-white/60">{settings.vsAI ? `AI (${settings.aiDifficulty})` : 'Human'}</span></li>
          </ul>
        </div>

        <div className="marvelous-glass p-8 rounded-[2.5rem] border-white/5">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 bg-purple-500/10 rounded-2xl border border-purple-500/20">
              <Cpu size={24} className="text-purple-500" />
            </div>
            <h3 className="font-black text-lg tracking-tighter uppercase">AI Strategy</h3>
          </div>
          <p className="text-sm text-white/40 leading-relaxed font-medium">
            The AI uses a Minimax algorithm with alpha-beta pruning. It evaluates piece counts, board positions, and potential kinging opportunities.
          </p>
        </div>
      </div>
    </div>
  );
}
