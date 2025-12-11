import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const API_BASE_URL = "http://localhost:4000";

const AdminUsersSessions = () => {
  const { token } = useAuth();
  const [searchEmail, setSearchEmail] = useState("");
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const authHeaders = () => {
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const handleSearch = async () => {
    try {
      setLoadingUsers(true);
      setSelectedUser(null);
      setSessions([]);

      const params = new URLSearchParams();
      if (searchEmail.trim()) {
        params.set("email", searchEmail.trim());
      }

      const res = await fetch(
        `${API_BASE_URL}/api/admin/users?${params.toString()}`,
        { headers: authHeaders() }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to load users");
      }

      setUsers(data.users || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load users");
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchSessions = async (userId: string) => {
    try {
      setLoadingSessions(true);
      const res = await fetch(
        `${API_BASE_URL}/api/admin/users/${userId}/sessions`,
        { headers: authHeaders() }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to load sessions");
      }
      setSessions(data.sessions || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load sessions");
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleSelectUser = async (user: any) => {
    setSelectedUser(user);
    await fetchSessions(user._id);
  };

  const handleLogoutAll = async () => {
    if (!selectedUser) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/logout-all`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ userId: selectedUser._id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to logout all sessions");
      }
      toast.success("All devices logged out for this user");
      await fetchSessions(selectedUser._id);
    } catch (err: any) {
      toast.error(err.message || "Failed to logout all devices");
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-card border border-border rounded-lg p-6">
          <h1 className="text-xl font-semibold mb-2">Admin: Users</h1>
          <p className="text-sm text-muted-foreground mb-4">
            Search users by email, then manage their active sessions.
          </p>
          <div className="flex gap-2 mb-4">
            <Input
              placeholder="Search by email"
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
            />
            <Button onClick={handleSearch} disabled={loadingUsers}>
              {loadingUsers ? "Searching..." : "Search"}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1">Email</th>
                  <th className="text-left py-1">Role</th>
                  <th className="text-left py-1">Created</th>
                  <th className="text-left py-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u._id} className="border-b">
                    <td className="py-1">{u.email}</td>
                    <td className="py-1">{u.role}</td>
                    <td className="py-1">
                      {u.createdAt ? new Date(u.createdAt).toLocaleString() : "-"}
                    </td>
                    <td className="py-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSelectUser(u)}
                      >
                        Manage sessions
                      </Button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && !loadingUsers && (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-2 text-center text-muted-foreground"
                    >
                      No users found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedUser && (
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="font-semibold">Session Control (Admin)</h2>
                <p className="text-xs text-muted-foreground">
                  Managing sessions for: <strong>{selectedUser.email}</strong>
                </p>
              </div>
              <Button variant="destructive" size="sm" onClick={handleLogoutAll}>
                Logout all devices
              </Button>
            </div>
            <div className="text-xs text-muted-foreground mb-3">
              Target userId: <code>{selectedUser._id}</code>
            </div>
            {loadingSessions ? (
              <div className="text-sm text-muted-foreground">Loading sessions...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1">IP</th>
                      <th className="text-left py-1">User Agent</th>
                      <th className="text-left py-1">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s._id} className="border-b">
                        <td className="py-1">{s.ip}</td>
                        <td className="py-1 max-w-xs truncate">{s.userAgent}</td>
                        <td className="py-1">
                          {s.createdAt
                            ? new Date(s.createdAt).toLocaleString()
                            : "-"}
                        </td>
                      </tr>
                    ))}
                    {sessions.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="py-2 text-center text-muted-foreground"
                        >
                          No active sessions
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminUsersSessions;
