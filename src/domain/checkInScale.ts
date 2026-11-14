/**
 * Re-export of the phone check-in scale.
 * The faces, the chips, and the coach hint read this one file,
 * so a saved number and the hint cannot disagree.
 * The source imports nothing from React Native.
 */
export {
    ENERGY_FACES,
    APPETITE_CHIPS,
    LOW_DAY_MESSAGE,
    NORMAL_SUCCESS_TEXT,
    WORTH_A_CHECK_IN_LABEL,
    nearestEnergyFace,
    nearestAppetite,
    isLowEnergy,
    isAlwaysHungry,
    isToughDay,
    checkInSuccessText,
    worthACheckIn,
} from '../../fitnessgurusg-mobile/src/checkin/scale';

export type {
    EnergyFaceId,
    EnergyFaceValue,
    AppetiteChipId,
    AppetiteValue,
    CheckInMood,
} from '../../fitnessgurusg-mobile/src/checkin/scale';
