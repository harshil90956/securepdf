import { useState, useEffect } from 'react';

import { useNavigate } from 'react-router-dom';
import { Upload as UploadIcon, Layers, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UploadZone } from '@/components/UploadZone';
import { SeriesGenerator } from '@/components/SeriesGenerator';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Navbar from '@/components/Navbar';
import { Input } from '@/components/ui/input';

const Upload = () => {
  const navigate = useNavigate();
  const { user, token, loading, signOut } = useAuth();

  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [searchEmail, setSearchEmail] = useState('');
  const [selectedAdminTarget, setSelectedAdminTarget] = useState<
    { id: string; email: string } | null
  >(null);
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);
  const [sessions, setSessions] = useState<
    Array<{ _id: string; ip: string; userAgent: string; createdAt: string }>
  >([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [allUsers, setAllUsers] = useState<
    Array<{
      _id: string;
      email: string;
      role?: string;
      createdAt?: string;
      sessionCount?: number;
      distinctIpCount?: number;
    }>
  >([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [ipOverview, setIpOverview] = useState<
    Array<{
      ip: string;
      sessionCount: number;
      lastSeen?: string;
      isBlocked?: boolean;
      blockedReason?: string | null;
    }>
  >([]);
  const [isLoadingIpOverview, setIsLoadingIpOverview] = useState(false);
  const [blockedIps, setBlockedIps] = useState<
    Array<{
      ip: string;
      reason?: string;
      isActive?: boolean;
      createdAt?: string;
      expiresAt?: string;
      blockedBy?: { email?: string };
    }>
  >([]);
  const [isLoadingBlockedIps, setIsLoadingBlockedIps] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth', { state: { from: '/upload' } });
    }
  }, [user, loading, navigate]);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !user || !token) return;

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('title', selectedFile.name);
      formData.append('totalPrints', '5');

      const res = await fetch('http://localhost:4000/api/docs/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = data.message || 'Upload failed';
        throw new Error(message);
      }

      const data = await res.json();

      toast.success('Document uploaded securely');

      navigate('/viewer', {
        state: {
          sessionToken: data.sessionToken,
          documentTitle: data.documentTitle,
          documentId: data.documentId,
          remainingPrints: data.remainingPrints,
          maxPrints: data.maxPrints,
          documentType: data.documentType,
        },
      });
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const handleLoadSessions = async () => {
    if (!searchEmail.trim()) {
      toast.error('Enter a user email first');
      return;
    }

    if (!token) {
      toast.error('Not authenticated');
      return;
    }

    setIsLoadingSessions(true);

    try {
      const params = new URLSearchParams({ email: searchEmail.trim() });
      const usersRes = await fetch(
        `http://localhost:4000/api/admin/users?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const usersData = await usersRes.json().catch(() => ({}));

      if (usersRes.status === 401 && (usersData as any).logout) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        toast.error('Session expired. Please login again.');
        navigate('/auth');
        return;
      }

      if (!usersRes.ok) {
        const message = (usersData as any).message || 'Failed to load users';
        throw new Error(message);
      }

      const list = (usersData as any).users || [];
      if (!Array.isArray(list) || list.length === 0) {
        toast.error('No users found for this email');
        setSelectedAdminTarget(null);
        setSessions([]);
        return;
      }

      const target = list[0];
      const userId = target._id;
      setSelectedAdminTarget({ id: userId, email: target.email });

      const res = await fetch(
        `http://localhost:4000/api/admin/users/${userId}/sessions`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await res.json().catch(() => ({}));

      if (res.status === 401 && (data as any).logout) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        toast.error('Session expired. Please login again.');
        navigate('/auth');
        return;
      }

      if (!res.ok) {
        const message = (data as any).message || 'Failed to load sessions';
        throw new Error(message);
      }

      setSessions((data as any).sessions || []);
    } catch (error) {
      console.error('Load sessions error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load sessions');
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const handleLogoutAllDevices = async () => {
    if (!selectedAdminTarget) {
      toast.error('Load a user by email first');
      return;
    }

    if (!token) {
      toast.error('Not authenticated');
      return;
    }

    setIsLoggingOutAll(true);

    try {
      const res = await fetch('http://localhost:4000/api/admin/logout-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId: selectedAdminTarget.id }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 401 && (data as any).logout) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        toast.error('Session expired. Please login again.');
        navigate('/auth');
        return;
      }

      if (!res.ok) {
        const message = (data as any).message || 'Failed to logout user from all devices';
        throw new Error(message);
      }

      toast.success('User logged out from all devices');
      setSessions([]);
    } catch (error) {
      console.error('Logout all devices error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to logout user');
    } finally {
      setIsLoggingOutAll(false);
    }
  };

  const handleLoadAllUsers = async () => {
    if (!token) {
      toast.error('Not authenticated');
      return;
    }

    setIsLoadingUsers(true);

    try {
      const res = await fetch('http://localhost:4000/api/admin/users/active-sessions', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 401 && (data as any).logout) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        toast.error('Session expired. Please login again.');
        navigate('/auth');
        return;
      }

      if (!res.ok) {
        const message = (data as any).message || 'Failed to load users';
        throw new Error(message);
      }

      setAllUsers((data as any).users || []);
    } catch (error) {
      console.error('Load users error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load users');
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleLoadIpOverview = async () => {
    if (!selectedAdminTarget) {
      toast.error('Select a user first');
      return;
    }

    if (!token) {
      toast.error('Not authenticated');
      return;
    }

    setIsLoadingIpOverview(true);

    try {
      const res = await fetch(
        `http://localhost:4000/api/admin/users/${selectedAdminTarget.id}/ip-overview`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const data = await res.json().catch(() => ({}));

      if (res.status === 401 && (data as any).logout) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        toast.error('Session expired. Please login again.');
        navigate('/auth');
        return;
      }

      if (!res.ok) {
        const message = (data as any).message || 'Failed to load IP overview';
        throw new Error(message);
      }

      setIpOverview((data as any).ips || []);
    } catch (error) {
      console.error('Load IP overview error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load IP overview');
    } finally {
      setIsLoadingIpOverview(false);
    }
  };

  const handleLoadBlockedIps = async () => {
    if (!token) {
      toast.error('Not authenticated');
      return;
    }

    setIsLoadingBlockedIps(true);

    try {
      const res = await fetch('http://localhost:4000/api/admin/blocked-ips', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 401 && (data as any).logout) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        toast.error('Session expired. Please login again.');
        navigate('/auth');
        return;
      }

      if (!res.ok) {
        const message = (data as any).message || 'Failed to load blocked IPs';
        throw new Error(message);
      }

      setBlockedIps((data as any).ips || []);
    } catch (error) {
      console.error('Load blocked IPs error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load blocked IPs');
    } finally {
      setIsLoadingBlockedIps(false);
    }
  };

  const handleBlockOtherIps = async () => {
    if (!selectedAdminTarget) {
      toast.error('Select a user first');
      return;
    }

    if (!token) {
      toast.error('Not authenticated');
      return;
    }

    try {
      const res = await fetch(
        `http://localhost:4000/api/admin/users/${selectedAdminTarget.id}/block-other-ips`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reason: 'Block all other IPs from admin panel' }),
        }
      );

      const data = await res.json().catch(() => ({}));

      if (res.status === 401 && (data as any).logout) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        toast.error('Session expired. Please login again.');
        navigate('/auth');
        return;
      }

      if (!res.ok) {
        const message = (data as any).message || 'Failed to block other IPs';
        throw new Error(message);
      }

      toast.success('Other IPs blocked for this user');
      await handleLoadSessions();
      await handleLoadIpOverview();
    } catch (error) {
      console.error('Block other IPs error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to block other IPs');
    }
  };

  const toggleSelectedUser = (id: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleBulkLogout = async () => {
    if (!token) {
      toast.error('Not authenticated');
      return;
    }

    if (selectedUserIds.length === 0) {
      toast.error('Select at least one user');
      return;
    }

    try {
      for (const id of selectedUserIds) {
        const res = await fetch('http://localhost:4000/api/admin/logout-all', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ userId: id }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = (data as any).message || 'Failed to logout user';
          throw new Error(msg);
        }
      }

      toast.success('Selected users logged out from all devices');
      setSelectedUserIds([]);
      await handleLoadAllUsers();
    } catch (error) {
      console.error('Bulk logout error', error);
      toast.error(error instanceof Error ? error.message : 'Failed to logout selected users');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="container py-8">
        <h1 className="text-2xl font-semibold mb-8">Document Tools</h1>

        <Tabs defaultValue="upload" className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="upload" className="gap-2">
              <UploadIcon className="h-4 w-4" />
              Secure Upload
            </TabsTrigger>
            <TabsTrigger value="series" className="gap-2">
              <Layers className="h-4 w-4" />
              Batch Series
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-6">
            <UploadZone
              onFileSelect={handleFileSelect}
              isUploading={isUploading}
            />

            {selectedFile && !isUploading && (
              <div className="flex justify-center animate-fade-in">
                <Button
                  size="lg"
                  onClick={handleUpload}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 h-14 px-8"
                >
                  <UploadIcon className="h-5 w-5" />
                  Upload & View Securely
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="series">
            {user && <SeriesGenerator userId={user.id} />}
          </TabsContent>
        </Tabs>

        {/* Security info */}
        <div className="mt-12 p-6 rounded-xl bg-card border border-border animate-fade-in" style={{ animationDelay: '0.2s' }}>
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Security Features
          </h3>
          <ul className="grid grid-cols-2 gap-3 text-sm text-muted-foreground">
            {[
              "Vector format preserved",
              "No download option",
              "No copy/paste",
              "Session controlled",
              "Watermarked prints",
              "Print count limits"
            ].map((feature, i) => (
              <li key={i} className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                {feature}
              </li>
            ))}
          </ul>
        </div>

        {user && user.role === 'admin' && (
          <div className="mt-6 p-4 rounded-xl bg-card border border-border animate-fade-in" style={{ animationDelay: '0.25s' }}>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Session Control (Admin)
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              View and control active sessions for a user. Search by email to see all logged-in devices.
            </p>
            {selectedAdminTarget && (
              <div className="text-xs text-muted-foreground mb-2">
                Selected user:&nbsp;
                <span className="font-medium text-foreground">{selectedAdminTarget.email}</span>
                &nbsp;(<code className="text-[10px]">{selectedAdminTarget.id}</code>)
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                placeholder="User email (e.g. user@example.com)"
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                className="sm:max-w-xs"
              />
              <Button
                variant="outline"
                onClick={handleLoadSessions}
                disabled={isLoadingSessions}
                className="w-full sm:w-auto"
              >
                {isLoadingSessions ? 'Loading sessions...' : 'View active sessions'}
              </Button>
              <Button
                variant="destructive"
                onClick={handleLogoutAllDevices}
                disabled={isLoggingOutAll}
                className="w-full sm:w-auto"
              >
                {isLoggingOutAll ? 'Logging out...' : 'Logout all devices'}
              </Button>
            </div>

            <div className="mt-4 border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-foreground">Users with active sessions</h4>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleLoadAllUsers}
                    disabled={isLoadingUsers}
                  >
                    {isLoadingUsers ? 'Loading...' : 'Load all users'}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleBulkLogout}
                    disabled={selectedUserIds.length === 0}
                  >
                    Logout selected
                  </Button>
                </div>
              </div>
              {allUsers.length > 0 && (
                <div className="max-h-64 overflow-y-auto border border-border/60 rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-b border-border/60">
                      <tr>
                        <th className="py-1 px-2 w-6 text-center">
                          <input
                            type="checkbox"
                            className="h-3 w-3"
                            checked={
                              allUsers.filter((u) => u.role !== 'admin').length > 0 &&
                              allUsers
                                .filter((u) => u.role !== 'admin')
                                .every((u) => selectedUserIds.includes(u._id))
                            }
                            onChange={(e) => {
                              const checked = e.target.checked;
                              if (checked) {
                                setSelectedUserIds(
                                  allUsers
                                    .filter((u) => u.role !== 'admin')
                                    .map((u) => u._id)
                                );
                              } else {
                                setSelectedUserIds([]);
                              }
                            }}
                          />
                        </th>
                        <th className="text-left py-1 px-2">Email</th>
                        <th className="text-left py-1 px-2">Role</th>
                        <th className="text-left py-1 px-2">Active sessions</th>
                        <th className="text-left py-1 px-2">Distinct IPs</th>
                        <th className="text-left py-1 px-2">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allUsers
                        .filter((u) => u.role !== 'admin')
                        .map((u) => (
                          <tr
                            key={u._id}
                            className="border-b border-border/40 last:border-0 hover:bg-muted/30 cursor-pointer"
                            onClick={() => {
                              setSearchEmail(u.email);
                              setSelectedAdminTarget({ id: u._id, email: u.email });
                            }}
                          >
                            <td className="py-1 px-2 text-center">
                              <input
                                type="checkbox"
                                className="h-3 w-3"
                                checked={selectedUserIds.includes(u._id)}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleSelectedUser(u._id);
                                }}
                              />
                            </td>
                            <td className="py-1 px-2">{u.email}</td>
                            <td className="py-1 px-2">{u.role || 'user'}</td>
                            <td className="py-1 px-2">{u.sessionCount ?? 0}</td>
                            <td className="py-1 px-2">{u.distinctIpCount ?? 0}</td>
                            <td className="py-1 px-2">
                              {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              {allUsers.length === 0 && !isLoadingUsers && (
                <p className="text-[11px] text-muted-foreground">
                  Users will appear here after you load them.
                </p>
              )}
            </div>

            {sessions.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr>
                      <th className="py-2 pr-2 text-left">IP address</th>
                      <th className="py-2 px-2 text-left">Browser / Device</th>
                      <th className="py-2 px-2 text-left">Login time</th>
                      <th className="py-2 pl-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s._id} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-2 align-top font-mono text-[11px] sm:text-xs">{s.ip}</td>
                        <td className="py-2 px-2 align-top max-w-xs truncate" title={s.userAgent}>
                          {s.userAgent || 'Unknown'}
                        </td>
                        <td className="py-2 px-2 align-top whitespace-nowrap">
                          {new Date(s.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2 pl-2 align-top text-right space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              if (!token) return;
                              try {
                                const res = await fetch(`http://localhost:4000/api/admin/sessions/${s._id}/logout`, {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    Authorization: `Bearer ${token}`,
                                  },
                                });

                                const data = await res.json().catch(() => ({}));

                                if (res.status === 401 && (data as any).logout) {
                                  localStorage.removeItem('auth_token');
                                  localStorage.removeItem('auth_user');
                                  toast.error('Session expired. Please login again.');
                                  navigate('/auth');
                                  return;
                                }

                                if (!res.ok) {
                                  const message = (data as any).message || 'Failed to logout session';
                                  throw new Error(message);
                                }

                                toast.success('Session logged out');
                                setSessions((prev) => prev.filter((x) => x._id !== s._id));
                              } catch (error) {
                                console.error('Logout session error:', error);
                                toast.error(
                                  error instanceof Error ? error.message : 'Failed to logout session'
                                );
                              }
                            }}
                          >
                            Logout
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={async () => {
                              if (!token) return;
                              try {
                                const res = await fetch(`http://localhost:4000/api/admin/sessions/${s._id}/block-ip`, {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    Authorization: `Bearer ${token}`,
                                  },
                                  body: JSON.stringify({ reason: 'Blocked from admin panel' }),
                                });

                                const data = await res.json().catch(() => ({}));

                                if (res.status === 401 && (data as any).logout) {
                                  localStorage.removeItem('auth_token');
                                  localStorage.removeItem('auth_user');
                                  toast.error('Session expired. Please login again.');
                                  navigate('/auth');
                                  return;
                                }

                                if (!res.ok) {
                                  const message = (data as any).message || 'Failed to block IP';
                                  throw new Error(message);
                                }

                                toast.success('IP blocked and sessions removed');
                                setSessions((prev) => prev.filter((x) => x.ip !== s.ip));
                              } catch (error) {
                                console.error('Block IP error:', error);
                                toast.error(error instanceof Error ? error.message : 'Failed to block IP');
                              }
                            }}
                          >
                            Block IP
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedAdminTarget && (
              <div className="mt-6 border-t border-border pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-foreground">IP overview for selected user</h4>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleLoadIpOverview}
                      disabled={isLoadingIpOverview}
                    >
                      {isLoadingIpOverview ? 'Loading IPs...' : 'Load IP overview'}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={handleBlockOtherIps}>
                      Block all other IPs
                    </Button>
                  </div>
                </div>
                {ipOverview.length > 0 && (
                  <div className="max-h-64 overflow-y-auto border border-border/60 rounded-md">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 border-b border-border/60">
                        <tr>
                          <th className="text-left py-1 px-2">IP</th>
                          <th className="text-left py-1 px-2">Total sessions</th>
                          <th className="text-left py-1 px-2">Last seen</th>
                          <th className="text-left py-1 px-2">Status</th>
                          <th className="text-left py-1 px-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ipOverview.map((row) => (
                          <tr key={row.ip} className="border-b border-border/40 last:border-0">
                            <td className="py-1 px-2 font-mono text-[11px] sm:text-xs">{row.ip}</td>
                            <td className="py-1 px-2">{row.sessionCount}</td>
                            <td className="py-1 px-2">
                              {row.lastSeen ? new Date(row.lastSeen).toLocaleString() : '-'}
                            </td>
                            <td className="py-1 px-2">
                              {row.isBlocked ? (
                                <span className="text-xs text-red-500">Blocked</span>
                              ) : (
                                <span className="text-xs text-green-500">Allowed</span>
                              )}
                            </td>
                            <td className="py-1 px-2">
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant={row.isBlocked ? 'outline' : 'destructive'}
                                  onClick={async () => {
                                    if (!token) return;
                                    try {
                                      const url = row.isBlocked
                                        ? 'http://localhost:4000/api/admin/unblock-ip'
                                        : 'http://localhost:4000/api/admin/block-ip';
                                      const res = await fetch(url, {
                                        method: 'POST',
                                        headers: {
                                          'Content-Type': 'application/json',
                                          Authorization: `Bearer ${token}`,
                                        },
                                        body: JSON.stringify({ ip: row.ip }),
                                      });
                                      const data = await res.json().catch(() => ({}));
                                      if (!res.ok) {
                                        const msg = (data as any).message || 'Failed to update IP status';
                                        throw new Error(msg);
                                      }
                                      toast.success(
                                        row.isBlocked ? 'IP unblocked' : 'IP blocked'
                                      );
                                      await handleLoadIpOverview();
                                    } catch (error) {
                                      console.error('Toggle IP block error', error);
                                      toast.error(
                                        error instanceof Error
                                          ? error.message
                                          : 'Failed to update IP status'
                                      );
                                    }
                                  }}
                                >
                                  {row.isBlocked ? 'Unblock' : 'Block'}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {ipOverview.length === 0 && !isLoadingIpOverview && (
                  <p className="text-[11px] text-muted-foreground">
                    IPs for this user will appear here after you load them.
                  </p>
                )}
              </div>
            )}

            <div className="mt-6 border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-foreground">Blocked IPs (global)</h4>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleLoadBlockedIps}
                  disabled={isLoadingBlockedIps}
                >
                  {isLoadingBlockedIps ? 'Loading...' : 'Refresh'}
                </Button>
              </div>
              {blockedIps.length > 0 && (
                <div className="max-h-64 overflow-y-auto border border-border/60 rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-b border-border/60">
                      <tr>
                        <th className="text-left py-1 px-2">IP</th>
                        <th className="text-left py-1 px-2">Reason</th>
                        <th className="text-left py-1 px-2">Blocked by</th>
                        <th className="text-left py-1 px-2">Expires at</th>
                        <th className="text-left py-1 px-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blockedIps.map((b) => (
                        <tr key={b.ip} className="border-b border-border/40 last:border-0">
                          <td className="py-1 px-2 font-mono text-[11px] sm:text-xs">{b.ip}</td>
                          <td className="py-1 px-2 max-w-xs truncate">{b.reason || '-'}</td>
                          <td className="py-1 px-2">Admin</td>
                          <td className="py-1 px-2">
                            {b.expiresAt
                              ? new Date(b.expiresAt).toLocaleString()
                              : '-'}
                          </td>
                          <td className="py-1 px-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                if (!token) return;
                                try {
                                  const res = await fetch(
                                    'http://localhost:4000/api/admin/unblock-ip',
                                    {
                                      method: 'POST',
                                      headers: {
                                        'Content-Type': 'application/json',
                                        Authorization: `Bearer ${token}`,
                                      },
                                      body: JSON.stringify({ ip: b.ip }),
                                    }
                                  );
                                  const data = await res.json().catch(() => ({}));
                                  if (!res.ok) {
                                    const msg = (data as any).message || 'Failed to unblock IP';
                                    throw new Error(msg);
                                  }
                                  toast.success('IP unblocked');
                                  await handleLoadBlockedIps();
                                } catch (error) {
                                  console.error('Unblock IP error', error);
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : 'Failed to unblock IP'
                                  );
                                }
                              }}
                            >
                              Unblock
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {blockedIps.length === 0 && !isLoadingBlockedIps && (
                <p className="text-[11px] text-muted-foreground">
                  No blocked IPs found. Use the Block IP buttons above to add some.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Upload;