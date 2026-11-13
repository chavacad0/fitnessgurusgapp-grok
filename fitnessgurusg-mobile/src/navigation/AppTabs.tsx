import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import ClientsScreen from '../screens/ClientsScreen';
import CoachDashboardScreen from '../screens/CoachDashboardScreen';
import InsightsScreen from '../screens/InsightsScreen';
import BookingScreen from '../screens/BookingScreen';
import CoachProfileScreen from '../screens/CoachProfileScreen';
import { colors, typography } from '../theme/theme';

const Tab = createBottomTabNavigator();

/**
 * AppTabs — authenticated coach tab navigator.
 *
 * Tab order follows the "Open → Understand → Act" principle:
 *   1. Dashboard  — decision screen (who needs attention right now?)
 *   2. Clients    — management + search
 *   3. Bookings   — today's sessions + scheduling  ← daily action screen
 *   4. Insights   — analytics
 *   5. Profile    — account + settings
 */
const TABS = [
    { name: 'Dashboard', component: CoachDashboardScreen, label: 'Dashboard', icon: 'home-outline',           activeIcon: 'home'          },
    { name: 'Clients',   component: ClientsScreen,        label: 'Clients',   icon: 'people-outline',         activeIcon: 'people'        },
    { name: 'Bookings',  component: BookingScreen,         label: 'Bookings',  icon: 'calendar-outline',       activeIcon: 'calendar'      },
    { name: 'Insights',  component: InsightsScreen,        label: 'Insights',  icon: 'bar-chart-outline',      activeIcon: 'bar-chart'     },
    { name: 'Profile',   component: CoachProfileScreen,    label: 'Profile',   icon: 'person-circle-outline',  activeIcon: 'person-circle' },
];

export default function AppTabs() {
    return (
        <Tab.Navigator
            initialRouteName="Dashboard"   // coach lands on decision screen immediately
            screenOptions={({ route }) => ({
                tabBarIcon: ({ focused, color, size }) => {
                    const tab = TABS.find(t => t.name === route.name);
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
                    height:          64,
                    paddingTop:      6,
                    paddingBottom:   8,
                },
                tabBarLabelStyle: {
                    ...typography.micro,
                    fontSize: 11,
                    letterSpacing: 0,
                },
                // Each coach screen draws its own navy header.
                headerShown: false,
            })}
        >
            {TABS.map(tab => (
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
