import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
from matplotlib.animation import FuncAnimation


# 玫瑰曲线参数方程
def rose_3d(theta, phi, a=1.0, b=0.2):
    r = a * np.sin(6 * theta) * np.cos(phi)
    x = r * np.cos(theta)
    y = r * np.sin(theta)
    z = b * np.sin(phi) + 0.3 * np.sin(2 * theta)
    return x, y, z


# 粒子系统类
class ParticleSystem:
    def __init__(self, num_particles=5000):
        self.num_particles = num_particles
        self.theta = np.random.uniform(0, 2 * np.pi, num_particles)
        self.phi = np.random.uniform(0, np.pi, num_particles)
        self.v_theta = np.random.uniform(-0.01, 0.01, num_particles)
        self.v_phi = np.random.uniform(-0.005, 0.005, num_particles)
        self.colors = plt.cm.RdYlGn(np.random.uniform(0, 1, num_particles))
        self.sizes = np.random.uniform(1, 3, num_particles)
        self.alphas = np.random.uniform(0.3, 0.9, num_particles)

    def update_particles(self, frame):
        self.theta += self.v_theta
        self.phi += self.v_phi
        self.theta = self.theta % (2 * np.pi)
        self.phi = np.clip(self.phi, 0.1, np.pi - 0.1)

        # 添加随机扰动
        self.v_theta += np.random.uniform(-0.001, 0.001, self.num_particles)
        self.v_phi += np.random.uniform(-0.0005, 0.0005, self.num_particles)

        # 计算新位置
        x, y, z = rose_3d(self.theta, self.phi, a=1 + 0.1 * np.sin(frame / 30))
        return x, y, z, self.colors, self.sizes, self.alphas


# 初始化图形
fig = plt.figure(figsize=(10, 8), facecolor='black')
ax = fig.add_subplot(111, projection='3d')
ax.set_facecolor('black')
ax.set_xticks([])
ax.set_yticks([])
ax.set_zticks([])

# 创建粒子系统
particles = ParticleSystem(num_particles=800)
x_init, y_init, z_init, colors, sizes, alphas = particles.update_particles(0)
scat = ax.scatter(x_init, y_init, z_init, c=colors, s=sizes, alpha=alphas, edgecolors='none')


# 动画更新函数
def update(frame):
    x, y, z, colors, sizes, alphas = particles.update_particles(frame)
    scat._offsets3d = (x, y, z)
    scat.set_color(colors)
    scat.set_sizes(sizes)
    scat.set_alpha(alphas)
    ax.view_init(elev=20, azim=frame * 0.5)
    return scat,


# 创建动画
ani = FuncAnimation(fig, update, frames=400, interval=50, blit=False, repeat=True)
plt.tight_layout()
plt.show()