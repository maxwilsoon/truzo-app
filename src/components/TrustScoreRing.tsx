import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors, getTierInfo } from '../theme/colors';

interface Props {
  score: number;
  size?: number;
}

// angleDeg: 0 = 12 o'clock, clockwise
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Builds an SVG arc path starting at startAngle, sweeping clockwise by sweepAngle degrees
function arcPath(cx: number, cy: number, r: number, startAngle: number, sweepAngle: number): string {
  const endAngle = startAngle + sweepAngle;
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = sweepAngle > 180 ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

const GAUGE_START = 225;   // degrees from 12 o'clock (= 7 o'clock position)
const GAUGE_SWEEP = 270;   // total arc span of the gauge

export const TrustScoreRing: React.FC<Props> = ({ score, size = 120 }) => {
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  const bgPath = arcPath(cx, cy, radius, GAUGE_START, GAUGE_SWEEP);
  const filledSweep = GAUGE_SWEEP * (Math.min(100, Math.max(0, score)) / 100);
  const fgPath = filledSweep > 0 ? arcPath(cx, cy, radius, GAUGE_START, filledSweep) : null;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Path
          d={bgPath}
          stroke={colors.border}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />
        {fgPath && (
          <Path
            d={fgPath}
            stroke={colors.cyan}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
          />
        )}
      </Svg>
      <Text style={styles.score}>{score}</Text>
      <Text style={styles.outOf}>/100</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  score: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    lineHeight: 32,
  },
  outOf: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
});
