import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import ClientHomeScreen     from '../screens/client/ClientHomeScreen';
import ClientProgressScreen from '../screens/client/ClientProgressScreen';
import ClientProfileScreen  from '../screens/client/ClientProfileScreen';
import ClientPlanScreen     from '../screens/client/ClientPlanScreen';
import ClientBookingScreen  from '../screens/client/ClientBookingScreen';
import { colors, typography } from '../theme/theme';

/**
 * ClientAppTabs — bottom tab navigator for CLIENT role users.
 *
 * Tabs (5):
 *  Home      → Daily check-in submission                  (ClientHomeScreen)
 *  Progress  → Check-in history & streaks                 (ClientProgressScreen)
 *  Book      → Browse & book available sessions           (ClientBookingScreen)
 *  My Plan   → Sessions remaining, expiry, package info   (ClientPlanScreen)
 *  Profile   → Account info + logout                      (ClientProfileScreen)
 *
 * Note: ClientMyBookingsScreen is pushed as a stack screen from within
 * ClientBookingScreen — it does not get a tab of its own.
 */

const Tab = createBottomTabNavigator();

const CLIENT_TABS = [
    { name: 'ClientHome',     label: 'Home',     component: ClientHomeScreen,     icon: 'home-outline',          activeIcon: 'home' },
    { name: 'ClientProgress', label: 'Progress', component: ClientProgressScreen, icon: 'trending-up-outline',   activeIcon: 'trending-up' },
    { name: 'ClientBook',     label: 'Book',     component: ClientBookingScreen,  icon: 'calendar-outline',      activeIcon: 'calendar' },
    { name: 'ClientPlan',     label: 'My Plan',  component: ClientPlanScreen,     icon: 'barbell-outline',       activeIcon: 'barbell' },
    { name: 'ClientProfile',  label: 'Profile',  component: ClientProfileScreen,  icon: 'person-outline',        activeIcon: 'person' },
] as const;

export default function ClientAppTabs() {
    return (
        <Tab.Navigator
            screenOptions={({ route }) => ({
                tabBarIcon: ({ focused, color, size }) => {
                    const tab = CLIENT_TABS.find(t => t.name === route.name);
                    const iconName = (focused ? tab?.activeIcon : tab?.icon) || 'ellipse-outline';
                    return <Ionicons name={iconName as any} size={size} color={color} />;
                },
                tabBarActiveTintColor:   colors.tabActive,
                tabBarInactiveTintColor: colors.tabInactive,
                tabBarStyle: {
                    backgroundColor: colors.surface,
                    borderTopWidth:  1,
                    borderTopColor:  colors.border,
                    elevation:       0,
                    shadowOpacity:   0,
                    height:          58,
                    paddingBottom:   8,
                },
                headerStyle: {
                    backgroundColor:   colors.surface,
                    shadowColor:       'transparent',
                    elevation:         0,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                },
                headerTintColor:  colors.textPrimary,
                headerTitleStyle: { ...typography.h3, color: colors.textPrimary },
            })}
        >
            {CLIENT_TABS.map(tab => (
                <Tab.Screen
                    key={tab.name}
                    name={tab.name}
                    component={tab.component}
                    options={{ title: tab.label }}
                />
            ))}
        </Tab.Navigator>
    );
}
