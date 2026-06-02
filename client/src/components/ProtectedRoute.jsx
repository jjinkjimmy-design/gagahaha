import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";

export default function ProtectedRoute({ children }) {
  const { accessToken, user } = useAuthStore();
  if (!accessToken || !user) return <Navigate to="/login" replace />;
  return children;
}
