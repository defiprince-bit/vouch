'use client';
import { Component, type ReactNode } from 'react';

/** Catches a render error in its subtree and shows `fallback` instead of the app-wide error page. */
export class RenderBoundary extends Component<{ fallback: ReactNode; label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn(`${this.props.label} failed to render`, e);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
