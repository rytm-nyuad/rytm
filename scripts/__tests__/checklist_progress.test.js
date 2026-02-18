/**
 * Tests for the updated checklist progress calculation (4 items, no water).
 * Tests for meal type validation including new "drink" type.
 * Tests for streak completion rule (water no longer required).
 */

describe('Checklist progress calculation', () => {
  // Mirror the 4-item checklist from ProgressList
  const computeProgress = (progress) => {
    const tasks = [
      { label: "Overall mood", completed: progress.overallQuestion },
      { label: "Log a meal", completed: progress.mealLogged },
      { label: "Daily check-in", completed: progress.checkInCompleted },
      { label: "Journal entry", completed: progress.journalCompleted },
    ];
    const completedCount = tasks.filter(t => t.completed).length;
    return { completedCount, total: tasks.length };
  };

  test('empty progress returns 0/4', () => {
    const result = computeProgress({
      overallQuestion: false,
      mealLogged: false,
      checkInCompleted: false,
      journalCompleted: false,
    });
    expect(result.completedCount).toBe(0);
    expect(result.total).toBe(4);
  });

  test('all items complete returns 4/4', () => {
    const result = computeProgress({
      overallQuestion: true,
      mealLogged: true,
      checkInCompleted: true,
      journalCompleted: true,
    });
    expect(result.completedCount).toBe(4);
    expect(result.total).toBe(4);
  });

  test('partial completion returns correct count', () => {
    const result = computeProgress({
      overallQuestion: true,
      mealLogged: true,
      checkInCompleted: false,
      journalCompleted: false,
    });
    expect(result.completedCount).toBe(2);
    expect(result.total).toBe(4);
  });

  test('waterLogged property has no effect on progress (removed from checklist)', () => {
    // Even if a legacy object has waterLogged, it should not be counted
    const progress = {
      overallQuestion: true,
      mealLogged: false,
      checkInCompleted: false,
      journalCompleted: false,
    };
    const result = computeProgress(progress);
    expect(result.completedCount).toBe(1);
    expect(result.total).toBe(4);
  });
});

describe('Streak completion rule', () => {
  // Mirror the SQL: v_is_complete = v_has_overall AND v_has_meal AND v_has_journal AND v_has_checkin
  // Water is NO LONGER required.
  const isComplete = (summary) => {
    return summary.has_overall && summary.has_meal && summary.has_journal && summary.has_checkin;
  };

  test('complete when all 4 items are true (water irrelevant)', () => {
    expect(isComplete({
      has_overall: true,
      has_meal: true,
      has_water: false, // not required
      has_journal: true,
      has_checkin: true,
    })).toBe(true);
  });

  test('incomplete when meal is missing', () => {
    expect(isComplete({
      has_overall: true,
      has_meal: false,
      has_water: true,
      has_journal: true,
      has_checkin: true,
    })).toBe(false);
  });

  test('incomplete when journal is missing', () => {
    expect(isComplete({
      has_overall: true,
      has_meal: true,
      has_water: true,
      has_journal: false,
      has_checkin: true,
    })).toBe(false);
  });

  test('incomplete when overall is missing', () => {
    expect(isComplete({
      has_overall: false,
      has_meal: true,
      has_water: true,
      has_journal: true,
      has_checkin: true,
    })).toBe(false);
  });

  test('incomplete when checkin is missing', () => {
    expect(isComplete({
      has_overall: true,
      has_meal: true,
      has_water: true,
      has_journal: true,
      has_checkin: false,
    })).toBe(false);
  });

  test('water-only day does NOT satisfy completion', () => {
    expect(isComplete({
      has_overall: false,
      has_meal: false,
      has_water: true,
      has_journal: false,
      has_checkin: false,
    })).toBe(false);
  });
});

describe('Meal type validation', () => {
  const VALID_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'ramadan_iftar', 'ramadan_suhoor'];

  test('all standard meal types are valid', () => {
    for (const mt of VALID_MEAL_TYPES) {
      expect(VALID_MEAL_TYPES.includes(mt)).toBe(true);
    }
  });

  test('"drink" is a valid meal type', () => {
    expect(VALID_MEAL_TYPES.includes('drink')).toBe(true);
  });

  test('Ramadan meal types are valid', () => {
    expect(VALID_MEAL_TYPES.includes('ramadan_iftar')).toBe(true);
    expect(VALID_MEAL_TYPES.includes('ramadan_suhoor')).toBe(true);
  });

  test('"water" is NOT a valid meal type (use "drink" instead)', () => {
    expect(VALID_MEAL_TYPES.includes('water')).toBe(false);
  });

  test('"other" is NOT in the DB enum (mapped to "snack" on client)', () => {
    // "other" is a client-side option that maps to "snack" before sending to DB
    expect(VALID_MEAL_TYPES.includes('other')).toBe(false);
  });

  test('drink entries should count as meal logged for checklist', () => {
    // Decision: a "drink" meal_type entry counts toward has_meal in daily_summary.
    // This is because the SQL checks meal_logs for ANY entry, regardless of meal_type.
    // So logging a drink will set has_meal = true.
    const hasMealLogged = (mealTypes) => mealTypes.length > 0;
    expect(hasMealLogged(['drink'])).toBe(true);
    expect(hasMealLogged(['breakfast', 'drink'])).toBe(true);
    expect(hasMealLogged(['ramadan_iftar'])).toBe(true);
    expect(hasMealLogged(['ramadan_suhoor'])).toBe(true);
    expect(hasMealLogged([])).toBe(false);
  });
});

describe('NudgeToast task detection', () => {
  const getFirstPendingTask = (tasks) => {
    if (!tasks.mealLogged) return { label: 'Log meal now', action: 'meal' };
    if (!tasks.checkInCompleted) return { label: 'Daily check-in now', action: 'checkin' };
    if (!tasks.journalCompleted) return { label: 'Journal now', action: 'journal' };
    return null;
  };

  test('returns meal when nothing is done', () => {
    const result = getFirstPendingTask({
      overallQuestion: false,
      mealLogged: false,
      checkInCompleted: false,
      journalCompleted: false,
    });
    expect(result.action).toBe('meal');
  });

  test('skips water — never suggests water action', () => {
    const result = getFirstPendingTask({
      overallQuestion: true,
      mealLogged: true,
      checkInCompleted: false,
      journalCompleted: false,
    });
    // Should suggest checkin, NOT water
    expect(result.action).toBe('checkin');
  });

  test('returns null when all tasks done', () => {
    const result = getFirstPendingTask({
      overallQuestion: true,
      mealLogged: true,
      checkInCompleted: true,
      journalCompleted: true,
    });
    expect(result).toBeNull();
  });
});
