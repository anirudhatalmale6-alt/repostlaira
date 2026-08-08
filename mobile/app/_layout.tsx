import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

const BG = '#12141c';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" backgroundColor={BG} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: BG },
          animation: 'fade',
        }}
      />
    </>
  );
}
