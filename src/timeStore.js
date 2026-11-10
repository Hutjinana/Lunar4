/**
 * Artemis Lunar Landing Site Navigator - Central Simulation Time Store
 * 
 * Round 3 - Time Control Architecture:
 * 1. Single authoritative reactive store for simulation time
 * 2. Start-epoch picker (default: today, UTC)
 * 3. User-selectable scrub span up to 365 days (e.g. 30d, 90d, 180d, 365d)
 * 4. Delta-time playback (no frame-rate drift)
 * 5. Jump functions: +1 day, +7 days, next New Moon, next Full Moon (astronomy-engine)
 */

import { findNextNewMoon, findNextFullMoon } from './ephemeris.js';
import { DEFAULT_MISSION_SPAN_DAYS } from './missionMetrics.js';

export class SimulationTimeStore {
  constructor(baseEpochStr = '2026-11-01T00:00:00Z') {
    // Default to today, UTC
    this.baseEpoch = new Date(baseEpochStr);
    this.elapsedDays = 0.0;
    this.maxDays = DEFAULT_MISSION_SPAN_DAYS; // scrub span = default mission window (user can pick up to 365 days)
    this.isPlaying = false;
    this.playbackSpeed = 5.0; // 1x, 5x, 20x, 100x
    this.subscribers = new Set();

    // Constant rate: at 1x speed, 0.1 days advance per real wall-clock second
    this.baseDaysPerSecond = 0.1;
  }

  /**
   * Returns current simulation Date object
   */
  getSimTime() {
    return new Date(this.baseEpoch.getTime() + this.elapsedDays * 86400 * 1000);
  }

  /**
   * Getter property for current simulation Date object
   */
  get simTime() {
    return this.getSimTime();
  }

  /**
   * Updates start epoch (e.g. from user date picker)
   */
  setBaseEpoch(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return;
    this.baseEpoch = date;
    // Keep elapsedDays bounded within [0, maxDays]
    this.elapsedDays = Math.max(0, Math.min(this.maxDays, this.elapsedDays));
    this._notify();
  }

  /**
   * Sets user-selected scrub span up to 365 days
   */
  setMaxDays(days) {
    const valid = Math.max(1, Math.min(365, Number(days) || 365));
    this.maxDays = valid;
    if (this.elapsedDays > this.maxDays) {
      this.elapsedDays = this.maxDays;
    }
    this._notify();
  }

  /**
   * Sets elapsed days directly from scrubber slider
   */
  setElapsedDays(days) {
    this.elapsedDays = Math.max(0, Math.min(this.maxDays, Number(days)));
    this._notify();
  }

  /**
   * Adds an offset in days (with wrap within [0, maxDays])
   */
  addElapsedDays(deltaDays) {
    let next = this.elapsedDays + Number(deltaDays);
    if (next > this.maxDays) {
      next = next % this.maxDays;
    } else if (next < 0) {
      next = (next % this.maxDays) + this.maxDays;
    }
    this.elapsedDays = next;
    this._notify();
  }

  /**
   * Sets simTime directly from an arbitrary Date object
   */
  setSimTime(targetDate) {
    const diffMs = targetDate.getTime() - this.baseEpoch.getTime();
    let days = diffMs / (86400 * 1000);
    if (days < 0) {
      // If targetDate is before baseEpoch, move baseEpoch back to targetDate
      this.baseEpoch = new Date(targetDate.getTime());
      days = 0;
    } else if (days > this.maxDays) {
      this.maxDays = Math.min(365, Math.ceil(days / 30) * 30);
    }
    this.setElapsedDays(days);
  }

  /**
   * Jumps to next New Moon using astronomy-engine
   */
  jumpToNextNewMoon() {
    const current = this.getSimTime();
    const nextNew = findNextNewMoon(current);
    if (nextNew) {
      this.setSimTime(nextNew);
      return nextNew;
    }
    return null;
  }

  /**
   * Jumps to next Full Moon using astronomy-engine
   */
  jumpToNextFullMoon() {
    const current = this.getSimTime();
    const nextFull = findNextFullMoon(current);
    if (nextFull) {
      this.setSimTime(nextFull);
      return nextFull;
    }
    return null;
  }

  /**
   * Toggles play/pause
   */
  togglePlay() {
    this.isPlaying = !this.isPlaying;
    this._notify();
  }

  setPlaying(playing) {
    this.isPlaying = Boolean(playing);
    this._notify();
  }

  setPlaybackSpeed(speed) {
    this.playbackSpeed = Math.max(0.1, Number(speed));
    this._notify();
  }

  /**
   * Advances simulation time based on real wall-clock delta time (eliminates framerate drift)
   * @param {number} deltaSeconds - Time elapsed since last frame in seconds
   */
  tick(deltaSeconds) {
    if (!this.isPlaying) return;
    const clampedDelta = Math.min(deltaSeconds, 0.2); // Guard against giant jumps on tab resume
    const dayIncrement = this.playbackSpeed * this.baseDaysPerSecond * clampedDelta;
    this.addElapsedDays(dayIncrement);
  }

  /**
   * Subscribes to time store state changes
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    callback(this.getSimTime(), this.elapsedDays, this.isPlaying, this);
    return () => this.subscribers.delete(callback);
  }

  _notify() {
    const simTime = this.getSimTime();
    for (const sub of this.subscribers) {
      sub(simTime, this.elapsedDays, this.isPlaying, this);
    }
  }
}

// Global singleton instance
export const timeStore = new SimulationTimeStore();
