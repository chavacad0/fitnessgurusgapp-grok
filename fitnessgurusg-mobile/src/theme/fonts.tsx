/**
 * Poppins (headings) and Inter (body) for the design kit.
 *
 * The app renders immediately. Fonts are applied only after they finish
 * loading. If loading throws or fails, text keeps the phone's built-in font
 * so the screen is never left blank.
 */

import React, { createContext, useContext, useEffect } from 'react';
import { TextStyle } from 'react-native';
import { useFonts } from 'expo-font';
import {
    Poppins_600SemiBold,
    Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import {
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
} from '@expo-google-fonts/inter';

/** Family names passed to React Native's fontFamily style. */
export const fontNames = {
    heading:          'Poppins_700Bold',
    headingSemibold:  'Poppins_600SemiBold',
    body:             'Inter_400Regular',
    bodyMedium:       'Inter_500Medium',
    bodySemibold:     'Inter_600SemiBold',
} as const;

const FONT_SOURCES = {
    [fontNames.heading]:         Poppins_700Bold,
    [fontNames.headingSemibold]: Poppins_600SemiBold,
    [fontNames.body]:            Inter_400Regular,
    [fontNames.bodyMedium]:      Inter_500Medium,
    [fontNames.bodySemibold]:    Inter_600SemiBold,
};

export type KitFonts = {
    /** True only when every kit font loaded successfully. */
    ready: boolean;
    heading: string | undefined;
    headingSemibold: string | undefined;
    body: string | undefined;
    bodyMedium: string | undefined;
    bodySemibold: string | undefined;
};

const SYSTEM_FONTS: KitFonts = {
    ready: false,
    heading: undefined,
    headingSemibold: undefined,
    body: undefined,
    bodyMedium: undefined,
    bodySemibold: undefined,
};

const LOADED_FONTS: KitFonts = {
    ready: true,
    heading: fontNames.heading,
    headingSemibold: fontNames.headingSemibold,
    body: fontNames.body,
    bodyMedium: fontNames.bodyMedium,
    bodySemibold: fontNames.bodySemibold,
};

const FontContext = createContext<KitFonts>(SYSTEM_FONTS);

/**
 * Use this on kit text. When the family is missing, the phone font and the
 * fallback weight are used instead — text stays visible.
 */
export function fontStyle(
    family: string | undefined,
    fallbackWeight: TextStyle['fontWeight'],
): TextStyle {
    if (family) {
        // The family file already includes its weight. Setting fontWeight as
        // well makes Android look for a different file and can hide the text.
        return { fontFamily: family, fontWeight: 'normal' };
    }
    return { fontWeight: fallbackWeight };
}

function FontLoader({ children }: { children: React.ReactNode }) {
    const [loaded, error] = useFonts(FONT_SOURCES);

    useEffect(() => {
        if (error) {
            console.warn(
                'FitnessGuruSG fonts failed to load. Using the phone\'s built-in fonts.',
                error,
            );
        }
    }, [error]);

    const value = loaded && !error ? LOADED_FONTS : SYSTEM_FONTS;
    return <FontContext.Provider value={value}>{children}</FontContext.Provider>;
}

type BoundaryProps = {
    children: React.ReactNode;
    fallback: React.ReactNode;
};

type BoundaryState = { failed: boolean };

/**
 * If the font hook throws while rendering, show the app with system fonts
 * instead of an empty screen.
 */
class FontErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
    state: BoundaryState = { failed: false };

    static getDerivedStateFromError(): BoundaryState {
        return { failed: true };
    }

    componentDidCatch(error: unknown) {
        console.warn(
            'FitnessGuruSG fonts failed to load. Using the phone\'s built-in fonts.',
            error,
        );
    }

    render() {
        if (this.state.failed) {
            return (
                <FontContext.Provider value={SYSTEM_FONTS}>
                    {this.props.fallback}
                </FontContext.Provider>
            );
        }
        return this.props.children;
    }
}

export function AppFontProvider({ children }: { children: React.ReactNode }) {
    return (
        <FontErrorBoundary fallback={children}>
            <FontLoader>{children}</FontLoader>
        </FontErrorBoundary>
    );
}

/** Kit font families, or undefined when the files are not ready. */
export function useKitFonts(): KitFonts {
    return useContext(FontContext);
}
