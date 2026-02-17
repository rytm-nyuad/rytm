// scripts/__tests__/daily_todos.test.js
// Unit tests for daily todo sorting rules, toggle behavior, and date scoping.

describe("daily_todos — sorting & behavior", () => {
  // ─── helpers ───
  function makeTodo(overrides = {}) {
    return {
      id: `id-${Math.random().toString(36).slice(2, 8)}`,
      user_id: "user-1",
      date: "2026-02-17",
      text: "Test task",
      is_completed: false,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };
  }

  /**
   * Split + sort the same way the listTodosByDate helper does.
   */
  function splitAndSort(todos) {
    const active = todos
      .filter((t) => !t.is_completed)
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

    const completed = todos
      .filter((t) => t.is_completed)
      .sort((a, b) => {
        const aTime = a.completed_at
          ? new Date(a.completed_at).getTime()
          : new Date(a.created_at).getTime();
        const bTime = b.completed_at
          ? new Date(b.completed_at).getTime()
          : new Date(b.created_at).getTime();
        return bTime - aTime; // DESC
      });

    return { active, completed };
  }

  // ─── Sorting rules ───
  test("active todos are sorted by created_at ascending", () => {
    const todos = [
      makeTodo({ id: "3", text: "Third", created_at: "2026-02-17T10:00:00Z" }),
      makeTodo({ id: "1", text: "First", created_at: "2026-02-17T08:00:00Z" }),
      makeTodo({ id: "2", text: "Second", created_at: "2026-02-17T09:00:00Z" }),
    ];

    const { active } = splitAndSort(todos);

    expect(active.map((t) => t.id)).toEqual(["1", "2", "3"]);
  });

  test("completed todos are sorted by completed_at descending", () => {
    const todos = [
      makeTodo({
        id: "a",
        is_completed: true,
        completed_at: "2026-02-17T11:00:00Z",
        created_at: "2026-02-17T08:00:00Z",
      }),
      makeTodo({
        id: "b",
        is_completed: true,
        completed_at: "2026-02-17T13:00:00Z",
        created_at: "2026-02-17T09:00:00Z",
      }),
      makeTodo({
        id: "c",
        is_completed: true,
        completed_at: "2026-02-17T12:00:00Z",
        created_at: "2026-02-17T10:00:00Z",
      }),
    ];

    const { completed } = splitAndSort(todos);

    expect(completed.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  test("active items come before completed items in split output", () => {
    const todos = [
      makeTodo({ id: "done-1", is_completed: true, completed_at: "2026-02-17T12:00:00Z" }),
      makeTodo({ id: "active-1", is_completed: false }),
      makeTodo({ id: "done-2", is_completed: true, completed_at: "2026-02-17T11:00:00Z" }),
      makeTodo({ id: "active-2", is_completed: false }),
    ];

    const { active, completed } = splitAndSort(todos);

    expect(active.length).toBe(2);
    expect(completed.length).toBe(2);
    expect(active.every((t) => !t.is_completed)).toBe(true);
    expect(completed.every((t) => t.is_completed)).toBe(true);
  });

  // ─── Toggle moves item between sections ───
  test("toggling a todo moves it from active to completed", () => {
    const todo = makeTodo({ id: "toggle-me", is_completed: false });
    const todos = [
      todo,
      makeTodo({ id: "stay-active", is_completed: false }),
    ];

    let { active, completed } = splitAndSort(todos);
    expect(active.map((t) => t.id)).toContain("toggle-me");
    expect(completed.map((t) => t.id)).not.toContain("toggle-me");

    // Simulate toggle
    const toggled = {
      ...todo,
      is_completed: true,
      completed_at: new Date().toISOString(),
    };
    const updatedTodos = todos.map((t) => (t.id === "toggle-me" ? toggled : t));

    ({ active, completed } = splitAndSort(updatedTodos));
    expect(active.map((t) => t.id)).not.toContain("toggle-me");
    expect(completed.map((t) => t.id)).toContain("toggle-me");
  });

  test("un-toggling a completed todo moves it back to active", () => {
    const todo = makeTodo({
      id: "uncomplete-me",
      is_completed: true,
      completed_at: "2026-02-17T12:00:00Z",
    });
    const todos = [
      todo,
      makeTodo({ id: "active-1", is_completed: false }),
    ];

    let { active, completed } = splitAndSort(todos);
    expect(completed.map((t) => t.id)).toContain("uncomplete-me");

    // Simulate un-toggle
    const untoggled = {
      ...todo,
      is_completed: false,
      completed_at: null,
    };
    const updatedTodos = todos.map((t) =>
      t.id === "uncomplete-me" ? untoggled : t
    );

    ({ active, completed } = splitAndSort(updatedTodos));
    expect(active.map((t) => t.id)).toContain("uncomplete-me");
    expect(completed.map((t) => t.id)).not.toContain("uncomplete-me");
  });

  // ─── Date scoping ───
  test("todos for different dates produce separate sets", () => {
    const allTodos = [
      makeTodo({ id: "feb17-1", date: "2026-02-17", text: "Task A" }),
      makeTodo({ id: "feb17-2", date: "2026-02-17", text: "Task B" }),
      makeTodo({ id: "feb18-1", date: "2026-02-18", text: "Task C" }),
      makeTodo({ id: "feb18-2", date: "2026-02-18", text: "Task D" }),
      makeTodo({ id: "feb16-1", date: "2026-02-16", text: "Task E" }),
    ];

    // Simulate filtering by date (same logic as the DB query's .eq("date", date))
    const filterByDate = (date) => allTodos.filter((t) => t.date === date);

    const feb17 = filterByDate("2026-02-17");
    const feb18 = filterByDate("2026-02-18");
    const feb16 = filterByDate("2026-02-16");

    expect(feb17.map((t) => t.id)).toEqual(["feb17-1", "feb17-2"]);
    expect(feb18.map((t) => t.id)).toEqual(["feb18-1", "feb18-2"]);
    expect(feb16.map((t) => t.id)).toEqual(["feb16-1"]);

    // Different dates don't mix
    expect(feb17).not.toEqual(feb18);
    expect(feb17.some((t) => t.date === "2026-02-18")).toBe(false);
  });

  test("empty date returns empty split", () => {
    const allTodos = [
      makeTodo({ date: "2026-02-17" }),
    ];

    const filtered = allTodos.filter((t) => t.date === "2026-03-01");
    const { active, completed } = splitAndSort(filtered);

    expect(active).toEqual([]);
    expect(completed).toEqual([]);
  });
});
