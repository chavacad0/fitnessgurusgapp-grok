/**
 * CoachStackParamList — typed navigation params for the coach modal stack.
 *
 * Defined here so any coach screen can import types without cross-importing
 * each other (previously, ClientPaymentDashboardScreen and PaymentConfirmScreen
 * both imported from PlanSelectionScreen, which is circular-ish and fragile).
 *
 * Stack screens (registered in RootNavigator > CoachNavigator):
 *   MainTabs       → AppTabs (coach tab navigator — no params)
 *   PlanSelection  → select a plan + payment method for a client
 *   PaymentConfirm → confirm receipt of payment, unlock sessions
 *   ClientPayments → per-client plan status + payment history
 *   AssignWorkout  → coach assigns a workout to a client for a date
 */
export type CoachStackParamList = {
    MainTabs:       undefined;
    PlanSelection:  { clientId: string; clientName: string };
    PaymentConfirm: {
        paymentId:  string;
        clientName: string;
        planName:   string;
        amount:     number;
    };
    ClientPayments: { clientId: string; clientName: string };
    AssignWorkout:  { clientId: string; clientName: string };
};
